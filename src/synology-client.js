const API_INFO = 'SYNO.API.Info';

export class SynologyError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SynologyError';
    this.code = code;
  }
}

export class SynologyClient {
  constructor({ baseUrl, username, password, fetchImpl = fetch }) {
    this.baseUrl = baseUrl;
    this.username = username;
    this.password = password;
    this.fetch = fetchImpl;
    this.sid = undefined;
    this.apis = {};
  }

  async request(path, params, authenticated = true) {
    const query = new URLSearchParams(params);
    if (authenticated && this.sid) query.set('_sid', this.sid);
    const response = await this.fetch(`${this.baseUrl}/webapi/${path}?${query}`);
    if (!response.ok) throw new SynologyError(`DSM a répondu HTTP ${response.status}`);
    const body = await response.json();
    if (!body.success) throw new SynologyError('La requête DSM a échoué', body.error?.code);
    return body.data;
  }

  async connect() {
    const requested = [
      'SYNO.API.Auth', 'SYNO.Core.System', 'SYNO.Core.System.Utilization',
      'SYNO.Storage.CGI.Storage', 'SYNO.Backup.Task', 'SYNO.HyperBackup.Task',
    ].join(',');
    this.apis = await this.request('query.cgi', {
      api: API_INFO, version: '1', method: 'query', query: requested,
    }, false);
    const auth = this.apis['SYNO.API.Auth'];
    if (!auth) throw new SynologyError("L'API d'authentification DSM est indisponible");
    const data = await this.request(auth.path, {
      api: 'SYNO.API.Auth', version: String(Math.min(auth.maxVersion, 7)), method: 'login',
      account: this.username, passwd: this.password, session: 'GladysSynology', format: 'sid',
    }, false);
    this.sid = data.sid;
  }

  async call(api, method, extra = {}) {
    if (!this.sid) await this.connect();
    const definition = this.apis[api];
    if (!definition) return undefined;
    try {
      return await this.request(definition.path, {
        api, version: String(definition.maxVersion), method, ...extra,
      });
    } catch (error) {
      if ([105, 106, 107, 119].includes(error.code)) {
        this.sid = undefined;
        await this.connect();
        return this.request(this.apis[api].path, {
          api, version: String(this.apis[api].maxVersion), method, ...extra,
        });
      }
      throw error;
    }
  }

  async collect({ hyperBackup = false } = {}) {
    const [system, utilization, storage] = await Promise.all([
      this.call('SYNO.Core.System', 'info'),
      this.call('SYNO.Core.System.Utilization', 'get'),
      this.call('SYNO.Storage.CGI.Storage', 'load_info'),
    ]);
    let backups;
    if (hyperBackup) {
      const api = this.apis['SYNO.HyperBackup.Task'] ? 'SYNO.HyperBackup.Task' : 'SYNO.Backup.Task';
      backups = await this.call(api, 'list').catch(() => undefined);
    }
    return normalizeMetrics({ system, utilization, storage, backups });
  }
}

function number(...values) {
  const value = values.find((item) => item !== undefined && item !== null && item !== '');
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeMetrics({ system = {}, utilization = {}, storage = {}, backups } = {}) {
  const cpu = utilization.cpu ?? {};
  const memory = utilization.memory ?? {};
  const disks = (storage.disks ?? storage.disk ?? []).map((disk, index) => ({
    id: String(disk.id ?? disk.disk_id ?? index + 1),
    name: disk.name ?? disk.model ?? `Disque ${index + 1}`,
    model: disk.model,
    smartStatus: disk.smart_status ?? disk.smartStatus ?? disk.status ?? 'unknown',
    temperature: number(disk.temp, disk.temperature),
  }));
  const volumes = (storage.volumes ?? storage.volume ?? []).map((volume, index) => {
    const total = number(volume.size?.total, volume.total_size, volume.total);
    const used = number(volume.size?.used, volume.used_size, volume.used);
    const free = number(volume.size?.free, volume.free_size, total !== undefined && used !== undefined ? total - used : undefined);
    return {
      id: String(volume.id ?? volume.volume_id ?? index + 1), name: volume.name ?? volume.id ?? `Volume ${index + 1}`,
      status: volume.status ?? 'unknown', totalBytes: total, freeBytes: free,
      usedPercent: total ? ((total - (free ?? 0)) / total) * 100 : undefined,
    };
  });
  const taskList = backups?.tasks ?? backups?.task ?? (Array.isArray(backups) ? backups : []);
  return {
    hostname: system.hostname ?? system.server_name ?? 'Synology',
    model: system.model ?? system.model_name,
    cpuPercent: number(cpu.user_load, cpu.user, cpu.load, utilization.cpu_usage),
    memoryPercent: number(memory.real_usage, memory.usage, utilization.memory_usage),
    temperature: number(system.temperature, system.sys_temp),
    disks, volumes,
    backups: taskList.map((task, index) => ({
      id: String(task.id ?? task.task_id ?? index + 1), name: task.name ?? `Sauvegarde ${index + 1}`,
      status: task.status ?? task.state ?? 'unknown', lastRun: task.last_bkp_time ?? task.last_run_time,
    })),
  };
}
