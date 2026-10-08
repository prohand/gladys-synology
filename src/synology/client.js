import { createLogger } from '@gladysassistant/integration-sdk';
import { SynologyApiError, apiError } from './errors.js';
import { SynologyMfaDeviceStore } from './mfa-device-store.js';
// fetch and Agent MUST come from the same undici package: Node's global fetch runs on the undici
// bundled with Node (6.x on Node 22, 7.x on Node 24), which rejects a dispatcher built by undici 8
// with "UND_ERR_INVALID_ARG invalid onRequestStart method": every self-signed NAS went offline in
// 2.2.0.
import { Agent, buildConnector, fetch as undiciFetch } from 'undici';

const logger = createLogger({ name: 'synology' });

export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

const REQUIRED_APIS = [
  'SYNO.API.Auth',
  'SYNO.Core.System',
  'SYNO.Core.System.Utilization',
  'SYNO.Storage.CGI.Storage',
];
const OPTIONAL_APIS = ['SYNO.Backup.Task', 'SYNO.ActiveBackup.Task'];
const SESSION_ERROR_CODES = new Set([106, 107, 119, 498]);
// DSM rejects a login for good with these codes: retrying cannot help.
const CREDENTIAL_ERROR_CODES = new Set([400, 401, 402, 407, 408, 409, 410]);
const MFA_DEVICE_NAME = 'Gladys Synology';
// DSM backup packages answer one call per task. A NAS with dozens of tasks would otherwise open
// dozens of requests at once against a box that is also serving its users.
export const BACKUP_TASK_CONCURRENCY = 4;
export const CERTIFICATE_MISMATCH_CODE = 'ERR_SYNOLOGY_CERTIFICATE_MISMATCH';
const CERTIFICATE_ERROR_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function clampVersion(info, preferred) {
  return Math.max(info.minVersion ?? 1, Math.min(preferred, info.maxVersion ?? preferred));
}

function isTimeout(error) {
  return error?.name === 'TimeoutError' || error?.cause?.name === 'TimeoutError';
}

function causeCode(error) {
  return error?.cause?.code ?? error?.code;
}

/** Runs `worker` over `items` with at most `limit` calls in flight, keeping the input order. */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

/**
 * The dispatcher for a NAS whose certificate the system CAs cannot vouch for. With a pinned
 * fingerprint, the TLS handshake still skips the CA check (a self-signed DSM certificate would fail
 * it) but the connection is dropped right after the handshake unless the certificate is exactly
 * the pinned one — before the first byte of any request, so the password never reaches an
 * impostor. `checkServerIdentity` cannot do this: Node only calls it when the CA check succeeded.
 */
function certificateDispatcher(fingerprint) {
  if (!fingerprint) return new Agent({ connect: { rejectUnauthorized: false } });
  const connect = buildConnector({ rejectUnauthorized: false });
  return new Agent({
    connect(options, callback) {
      connect(options, (error, socket) => {
        if (error) return callback(error);
        const presented = socket.getPeerCertificate?.()?.fingerprint256 ?? '';
        if (presented.replace(/:/g, '').toLowerCase() === fingerprint) {
          return callback(null, socket);
        }
        socket.destroy();
        const mismatch = new Error(
          `The certificate presented by ${options.hostname} does not match the pinned SHA-256 fingerprint`,
        );
        mismatch.code = CERTIFICATE_MISMATCH_CODE;
        return callback(mismatch);
      });
    },
  });
}

export class SynologyClient {
  constructor(
    config,
    {
      fetchImpl = undiciFetch,
      mfaDeviceStore = new SynologyMfaDeviceStore(),
      requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    } = {},
  ) {
    this.config = config;
    this.fetch = fetchImpl;
    this.apis = null;
    this.sid = null;
    this.loginPromise = null;
    this.requestTimeoutMs = requestTimeoutMs;
    this.mfaDeviceStore = mfaDeviceStore;
    const fingerprint = config.cert_fingerprint || '';
    this.dispatcher =
      config.url.startsWith('https://') && (fingerprint || !config.verify_ssl)
        ? certificateDispatcher(fingerprint)
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
        // A NAS that accepts the connection but never answers would otherwise keep the refresh
        // promise pending forever, and every later poll would wait behind it.
        signal: AbortSignal.timeout(this.requestTimeoutMs),
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      });
    } catch (cause) {
      if (isTimeout(cause)) {
        const seconds = Math.round(this.requestTimeoutMs / 1000);
        throw new SynologyApiError(`Synology DSM did not answer within ${seconds}s`, { cause });
      }
      const code = causeCode(cause);
      if (code === CERTIFICATE_MISMATCH_CODE) {
        throw new SynologyApiError(
          'Synology DSM certificate does not match the pinned SHA-256 fingerprint: connection refused before signing in',
          { cause },
        );
      }
      if (CERTIFICATE_ERROR_CODES.has(code)) {
        throw new SynologyApiError(
          `Synology DSM certificate rejected (${code}): pin its SHA-256 fingerprint or disable the certificate check`,
          { cause },
        );
      }
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

  // DSM blocks an IP address after a few failed logins, and a snapshot fires five API calls at
  // once: without this, an expired session would trigger one login per in-flight call.
  async login() {
    if (!this.loginPromise) {
      this.loginPromise = this.performLogin().finally(() => {
        this.loginPromise = null;
      });
    }
    return this.loginPromise;
  }

  // Re-authenticate unless a concurrent call already replaced the session we were using.
  async ensureSession(previousSid) {
    if (this.sid && this.sid !== previousSid) return;
    this.sid = null;
    return this.login();
  }

  async loadTrustedDevice() {
    try {
      return await this.mfaDeviceStore.load(this.config);
    } catch (error) {
      // The remembered device only saves an OTP round-trip: an unreadable /data volume
      // must never keep the integration from signing in.
      logger.warn(`Unable to read the Synology trusted device: ${error.message}`);
      return null;
    }
  }

  async saveTrustedDevice(deviceId) {
    try {
      await this.mfaDeviceStore.save(this.config, deviceId);
    } catch (error) {
      logger.warn(`Unable to persist the Synology trusted device: ${error.message}`);
    }
  }

  async performLogin() {
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
    const deviceId = await this.loadTrustedDevice();
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
    if (!payload.success && deviceId && !CREDENTIAL_ERROR_CODES.has(payload.error?.code)) {
      // A DSM update, a reboot or a revoked trusted device invalidates the remembered
      // device identifier. Retry a full login instead of failing the whole connection,
      // so a stale identifier never keeps the integration offline.
      payload = await this.request(info.path, { ...baseParameters, ...otpParameters });
    }
    if (!payload.success) throw apiError('SYNO.API.Auth', payload.error?.code);
    this.sid = payload.data?.sid;
    if (!this.sid) throw new SynologyApiError('Synology DSM login returned no session ID');
    if (payload.data?.did) await this.saveTrustedDevice(payload.data.did);
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

    const usedSid = this.sid;
    let payload = await invoke();
    if (!payload.success && SESSION_ERROR_CODES.has(payload.error?.code)) {
      await this.ensureSession(usedSid);
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
    const enriched = await mapWithConcurrency(taskList, BACKUP_TASK_CONCURRENCY, async (task) => {
      const taskId = task.task_id ?? task.id;
      if (taskId === undefined) return task;
      const status = await this.optionalCall(
        'SYNO.Backup.Task',
        'status',
        { task_id: String(taskId), additional: '["last_bkp_result","last_bkp_time"]' },
        { preferredVersion: 1 },
      );
      return status ? { ...task, ...status } : task;
    });
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
    const enriched = await mapWithConcurrency(tasks, BACKUP_TASK_CONCURRENCY, async (task) => {
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
    });
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
