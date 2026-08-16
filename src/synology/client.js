import { SynologyApiError, apiError } from './errors.js';
import { Agent } from 'undici';

const REQUIRED_APIS = [
  'SYNO.API.Auth',
  'SYNO.Core.System',
  'SYNO.Core.System.Utilization',
  'SYNO.Storage.CGI.Storage',
];
const SESSION_ERROR_CODES = new Set([106, 107, 119]);

function clampVersion(info, preferred) {
  return Math.max(info.minVersion ?? 1, Math.min(preferred, info.maxVersion ?? preferred));
}

export class SynologyClient {
  constructor(config, { fetchImpl = globalThis.fetch } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    this.apis = null;
    this.sid = null;
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
      query: REQUIRED_APIS.join(','),
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
    const payload = await this.request(info.path, {
      api: 'SYNO.API.Auth',
      version: String(clampVersion(info, 7)),
      method: 'login',
      account: this.config.username,
      passwd: this.config.password,
      session: 'GladysSynology',
      format: 'sid',
    });
    if (!payload.success) throw apiError('SYNO.API.Auth', payload.error?.code);
    this.sid = payload.data?.sid;
    if (!this.sid) throw new SynologyApiError('Synology DSM login returned no session ID');
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

  async getSnapshot() {
    if (!this.apis) await this.discoverApis();
    if (!this.sid) await this.login();
    const [system, utilization, storage] = await Promise.all([
      this.call('SYNO.Core.System', 'info', {}, { preferredVersion: 3 }),
      this.call('SYNO.Core.System.Utilization', 'get', {}, { preferredVersion: 1 }),
      this.call(
        'SYNO.Storage.CGI.Storage',
        'load_info',
        {},
        { preferredVersion: 1, required: false },
      ),
    ]);
    return { system, utilization, storage };
  }
}
