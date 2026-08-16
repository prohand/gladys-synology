import { SynologyApiError, apiError } from './errors.js';
import { SynologyMfaDeviceStore } from './mfa-device-store.js';
import { Agent } from 'undici';

const REQUIRED_APIS = [
  'SYNO.API.Auth',
  'SYNO.Core.System',
  'SYNO.Core.System.Utilization',
  'SYNO.Storage.CGI.Storage',
];
const OPTIONAL_APIS = ['SYNO.Backup.Task', 'SYNO.ActiveBackup.Task'];
const SESSION_ERROR_CODES = new Set([106, 107, 119]);
const MFA_ERROR_CODES = new Set([403, 404, 406]);
const MFA_DEVICE_NAME = 'Gladys Synology';

function clampVersion(info, preferred) {
  return Math.max(info.minVersion ?? 1, Math.min(preferred, info.maxVersion ?? preferred));
}

export class SynologyClient {
  constructor(
    config,
    { fetchImpl = globalThis.fetch, mfaDeviceStore = new SynologyMfaDeviceStore() } = {},
  ) {
    this.config = config;
    this.fetch = fetchImpl;
    this.apis = null;
    this.sid = null;
    this.mfaDeviceStore = mfaDeviceStore;
    this.dispatcher =
      config.url.startsWith('https://') && !config.verify_ssl
        ? new Agent({ connect: { rejectUnauthorized: false } })
        : null;
  }

  async request(path, parameters) {
    const body = new URLSearchParams(parameters);
    let response;
    try {
      response = await this.fetch(`${this.config.url}/webapi/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      });
    } catch (cause) {
      throw new SynologyApiError('Unable to reach Synology DSM', { cause });
    }

    if (!response.ok) {
      throw new SynologyApiError(`Synology DSM returned HTTP ${response.status}`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new SynologyApiError('Synology DSM returned an invalid JSON response', { cause });
    }
    return payload;
  }

  async discoverApis() {
    const payload = await this.request('query.cgi', {
      api: 'SYNO.API.Info',
      version: '1',
      method: 'query',
      query: [...REQUIRED_APIS, ...OPTIONAL_APIS].join(','),
    });
    if (!payload.success) throw apiError('SYNO.API.Info', payload.error?.code);
    this.apis = payload.data ?? {};
    return this.apis;
  }

  apiInfo(name, required = true) {
    const info = this.apis?.[name];
    if (!info && required) {
      throw new SynologyApiError(`Synology DSM does not expose ${name}`, { api: name });
    }
    return info;
  }

  async login() {
    if (!this.apis) await this.discoverApis();
    const info = this.apiInfo('SYNO.API.Auth');
    const baseParameters = {
      api: 'SYNO.API.Auth',
      version: String(clampVersion(info, 6)),
      method: 'login',
      account: this.config.username,
      passwd: this.config.password,
      session: 'GladysSynology',
      format: 'sid',
    };
    const deviceId = await this.mfaDeviceStore.load(this.config);
    const otpParameters = this.config.otp_code
      ? {
          otp_code: this.config.otp_code,
          enable_device_token: 'yes',
          device_name: MFA_DEVICE_NAME,
        }
      : {};
    let payload = await this.request(info.path, {
      ...baseParameters,
      ...(deviceId ? { device_name: MFA_DEVICE_NAME, device_id: deviceId } : otpParameters),
    });
    if (
      !payload.success &&
      deviceId &&
      this.config.otp_code &&
      MFA_ERROR_CODES.has(payload.error?.code)
    ) {
      payload = await this.request(info.path, { ...baseParameters, ...otpParameters });
    }
    if (!payload.success) throw apiError('SYNO.API.Auth', payload.error?.code);
    this.sid = payload.data?.sid;
    if (!this.sid) throw new SynologyApiError('Synology DSM login returned no session ID');
    if (payload.data?.did) await this.mfaDeviceStore.save(this.config, payload.data.did);
    return payload.data;
  }

  async logout() {
    if (!this.sid || !this.apis) return;
    const info = this.apiInfo('SYNO.API.Auth');
    try {
      await this.request(info.path, {
        api: 'SYNO.API.Auth',
        version: String(clampVersion(info, 7)),
        method: 'logout',
        session: 'GladysSynology',
        _sid: this.sid,
      });
    } finally {
      this.sid = null;
    }
  }

  async close() {
    await this.logout().catch(() => {});
    await this.dispatcher?.close();
  }

  async call(name, method, parameters = {}, { preferredVersion = 1, required = true } = {}) {
    if (!this.apis) await this.discoverApis();
    if (!this.sid) await this.login();
    const info = this.apiInfo(name, required);
    if (!info) return null;

    const invoke = () =>
      this.request(info.path, {
        api: name,
        version: String(clampVersion(info, preferredVersion)),
        method,
        ...parameters,
        _sid: this.sid,
      });

    let payload = await invoke();
    if (!payload.success && SESSION_ERROR_CODES.has(payload.error?.code)) {
      this.sid = null;
      await this.login();
      payload = await invoke();
    }
    if (!payload.success) throw apiError(name, payload.error?.code);
    return payload.data ?? {};
  }

  async optionalCall(name, method, parameters = {}, options = {}) {
    if (!this.apiInfo(name, false)) return null;
    try {
      return await this.call(name, method, parameters, { ...options, required: false });
    } catch (error) {
      // Backup packages expose private DSM APIs whose permissions and methods vary by version.
      // Their absence must not disable the NAS system and storage monitoring.
      if (error instanceof SynologyApiError && error.api === name) return null;
      throw error;
    }
  }

  async getHyperBackup() {
    const list = await this.optionalCall('SYNO.Backup.Task', 'list', {}, { preferredVersion: 1 });
    if (!list) return null;
    const taskList = Array.isArray(list.task_list)
      ? list.task_list
      : Array.isArray(list.tasks)
        ? list.tasks
        : [];
    const enriched = await Promise.all(
      taskList.map(async (task) => {
        const taskId = task.task_id ?? task.id;
        if (taskId === undefined) return task;
        const status = await this.optionalCall(
          'SYNO.Backup.Task',
          'status',
          { task_id: String(taskId), additional: '["last_bkp_result","last_bkp_time"]' },
          { preferredVersion: 1 },
        );
        return status ? { ...task, ...status } : task;
      }),
    );
    return { ...list, task_list: enriched };
  }

  async getActiveBackup() {
    const list = await this.optionalCall(
      'SYNO.ActiveBackup.Task',
      'list',
      {},
      { preferredVersion: 1 },
    );
    if (!list) return null;
    const tasks = Array.isArray(list.tasks)
      ? list.tasks
      : Array.isArray(list.task_list)
        ? list.task_list
        : [];
    const enriched = await Promise.all(
      tasks.map(async (task) => {
        const taskId = task.task_id ?? task.id;
        if (taskId === undefined) return task;
        const detail = await this.optionalCall(
          'SYNO.ActiveBackup.Task',
          'list',
          {
            load_verify_status: 'true',
            load_versions: 'true',
            filter: JSON.stringify({ task_id: taskId, data_formats: [1, 4] }),
          },
          { preferredVersion: 1 },
        );
        const detailedTask = detail?.tasks?.[0] ?? detail?.task_list?.[0];
        return detailedTask ? { ...task, ...detailedTask } : task;
      }),
    );
    return {
      ...list,
      tasks: enriched,
      ...(Array.isArray(list.task_list) ? { task_list: enriched } : {}),
    };
  }

  async getSnapshot() {
    if (!this.apis) await this.discoverApis();
    if (!this.sid) await this.login();
    const [system, utilization, storage, hyperBackup, activeBackup] = await Promise.all([
      this.call('SYNO.Core.System', 'info', {}, { preferredVersion: 3 }),
      this.call('SYNO.Core.System.Utilization', 'get', {}, { preferredVersion: 1 }),
      this.call(
        'SYNO.Storage.CGI.Storage',
        'load_info',
        {},
        { preferredVersion: 1, required: false },
      ),
      this.getHyperBackup(),
      this.getActiveBackup(),
    ]);
    return { system, utilization, storage, hyperBackup, activeBackup };
  }
}
