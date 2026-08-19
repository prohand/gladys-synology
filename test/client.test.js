import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeConfig } from '../src/config.js';
import { SynologyClient } from '../src/synology/client.js';

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test('client discovers APIs, authenticates with POST and fetches a snapshot', async () => {
  const calls = [];
  const apiData = {
    'SYNO.API.Auth': { path: 'auth.cgi', minVersion: 1, maxVersion: 7 },
    'SYNO.Core.System': { path: 'entry.cgi', minVersion: 1, maxVersion: 3 },
    'SYNO.Core.System.Utilization': { path: 'entry.cgi', minVersion: 1, maxVersion: 1 },
    'SYNO.Storage.CGI.Storage': { path: 'entry.cgi', minVersion: 1, maxVersion: 1 },
  };
  const fetchImpl = async (url, options) => {
    const body = Object.fromEntries(options.body.entries());
    calls.push({ url, method: options.method, body });
    if (body.api === 'SYNO.API.Info') return jsonResponse({ success: true, data: apiData });
    if (body.api === 'SYNO.API.Auth' && body.method === 'login') {
      return jsonResponse({ success: true, data: { sid: 'secret-session' } });
    }
    if (body.api === 'SYNO.Core.System') {
      return jsonResponse({ success: true, data: { model: 'DS920+' } });
    }
    if (body.api === 'SYNO.Core.System.Utilization') {
      return jsonResponse({ success: true, data: { cpu: { user_load: 1 } } });
    }
    return jsonResponse({ success: true, data: { volumes: [] } });
  };
  const client = new SynologyClient(
    normalizeConfig({ url: 'https://nas:5001', username: 'gladys', password: 'password' }),
    { fetchImpl },
  );

  const snapshot = await client.getSnapshot();
  assert.equal(snapshot.system.model, 'DS920+');
  assert.equal(calls.filter((call) => call.body.method === 'login').length, 1);
  assert.ok(calls.every((call) => call.method === 'POST'));
  assert.ok(calls.every((call) => !call.url.includes('password')));
  assert.equal(calls.find((call) => call.body.method === 'login').body.passwd, 'password');
  assert.ok(calls.filter((call) => call.body._sid === 'secret-session').length >= 3);
});

test('client retries once after an expired DSM session', async () => {
  let loginCount = 0;
  let systemCount = 0;
  const client = new SynologyClient(
    normalizeConfig({ url: 'http://nas:5000', username: 'u', password: 'p' }),
    {
      fetchImpl: async (_url, options) => {
        const body = Object.fromEntries(options.body.entries());
        if (body.api === 'SYNO.API.Info') {
          return jsonResponse({
            success: true,
            data: {
              'SYNO.API.Auth': { path: 'auth.cgi', minVersion: 1, maxVersion: 7 },
              'SYNO.Core.System': { path: 'entry.cgi', minVersion: 1, maxVersion: 3 },
            },
          });
        }
        if (body.api === 'SYNO.API.Auth') {
          loginCount += 1;
          return jsonResponse({ success: true, data: { sid: `sid-${loginCount}` } });
        }
        systemCount += 1;
        return systemCount === 1
          ? jsonResponse({ success: false, error: { code: 106 } })
          : jsonResponse({ success: true, data: { model: 'DS224+' } });
      },
    },
  );

  const system = await client.call('SYNO.Core.System', 'info', {}, { preferredVersion: 3 });
  assert.equal(system.model, 'DS224+');
  assert.equal(loginCount, 2);
  assert.equal(systemCount, 2);
});

test('client loads optional Hyper Backup and Active Backup task APIs when available', async () => {
  const apiData = {
    'SYNO.API.Auth': { path: 'auth.cgi', minVersion: 1, maxVersion: 7 },
    'SYNO.Core.System': { path: 'entry.cgi', minVersion: 1, maxVersion: 3 },
    'SYNO.Core.System.Utilization': { path: 'entry.cgi', minVersion: 1, maxVersion: 1 },
    'SYNO.Storage.CGI.Storage': { path: 'entry.cgi', minVersion: 1, maxVersion: 1 },
    'SYNO.Backup.Task': { path: 'entry.cgi', minVersion: 1, maxVersion: 2 },
    'SYNO.ActiveBackup.Task': { path: 'entry.cgi', minVersion: 1, maxVersion: 1 },
  };
  const client = new SynologyClient(
    normalizeConfig({ url: 'https://nas:5001', username: 'u', password: 'p' }),
    {
      fetchImpl: async (_url, options) => {
        const body = Object.fromEntries(options.body.entries());
        if (body.api === 'SYNO.API.Info') {
          assert.match(body.query, /SYNO\.Backup\.Task/);
          assert.match(body.query, /SYNO\.ActiveBackup\.Task/);
          return jsonResponse({ success: true, data: apiData });
        }
        if (body.api === 'SYNO.API.Auth') {
          return jsonResponse({ success: true, data: { sid: 'sid' } });
        }
        if (body.api === 'SYNO.Backup.Task') {
          return body.method === 'list'
            ? jsonResponse({ success: true, data: { task_list: [{ task_id: 1 }] } })
            : jsonResponse({
                success: true,
                data: { last_bkp_result: 'success', last_bkp_time: 1_700_000_000 },
              });
        }
        if (body.api === 'SYNO.ActiveBackup.Task') {
          if (!body.filter) {
            return jsonResponse({
              success: true,
              data: { tasks: [{ task_id: 2, task_name: 'Workstations' }] },
            });
          }
          assert.equal(body.load_versions, 'true');
          assert.deepEqual(JSON.parse(body.filter), { task_id: 2, data_formats: [1, 4] });
          return jsonResponse({
            success: true,
            data: {
              tasks: [
                {
                  task_id: 2,
                  last_result: { status: 2, time_end: 1_700_000_100 },
                  versions: [{ status: 3, time_end: 1_700_000_100 }],
                },
              ],
            },
          });
        }
        return jsonResponse({ success: true, data: {} });
      },
    },
  );

  const snapshot = await client.getSnapshot();
  assert.equal(snapshot.hyperBackup.task_list[0].task_id, 1);
  assert.equal(snapshot.hyperBackup.task_list[0].last_bkp_result, 'success');
  assert.equal(snapshot.activeBackup.tasks[0].task_id, 2);
  assert.equal(snapshot.activeBackup.tasks[0].task_name, 'Workstations');
  assert.equal(snapshot.activeBackup.tasks[0].last_result.time_end, 1_700_000_100);
});

test('client reports DSM authentication errors without exposing the password', async () => {
  const client = new SynologyClient(
    normalizeConfig({ url: 'http://nas:5000', username: 'u', password: 'top-secret' }),
    {
      fetchImpl: async (_url, options) => {
        const body = Object.fromEntries(options.body.entries());
        return body.api === 'SYNO.API.Info'
          ? jsonResponse({
              success: true,
              data: { 'SYNO.API.Auth': { path: 'auth.cgi', minVersion: 1, maxVersion: 7 } },
            })
          : jsonResponse({ success: false, error: { code: 400 } });
      },
    },
  );

  await assert.rejects(client.login(), (error) => {
    assert.match(error.message, /Invalid DSM credentials/);
    assert.doesNotMatch(error.message, /top-secret/);
    return true;
  });
});

test('client enrolls a remembered DSM device with the current OTP', async () => {
  const loginCalls = [];
  const saved = [];
  const mfaDeviceStore = {
    async load() {
      return null;
    },
    async save(config, deviceId) {
      saved.push({ config, deviceId });
    },
  };
  const client = new SynologyClient(
    normalizeConfig({
      url: 'https://nas:5001',
      username: 'gladys',
      password: 'password',
      otp_code: '123456',
    }),
    {
      mfaDeviceStore,
      fetchImpl: async (_url, options) => {
        const body = Object.fromEntries(options.body.entries());
        if (body.api === 'SYNO.API.Info') {
          return jsonResponse({
            success: true,
            data: { 'SYNO.API.Auth': { path: 'entry.cgi', minVersion: 3, maxVersion: 7 } },
          });
        }
        loginCalls.push(body);
        return jsonResponse({ success: true, data: { sid: 'sid', did: 'remembered-device' } });
      },
    },
  );

  await client.login();
  assert.equal(loginCalls.length, 1);
  assert.equal(loginCalls[0].version, '6');
  assert.equal(loginCalls[0].otp_code, '123456');
  assert.equal(loginCalls[0].enable_device_token, 'yes');
  assert.equal(loginCalls[0].device_name, 'Gladys Synology');
  assert.equal(loginCalls[0].device_id, undefined);
  assert.equal(saved[0].deviceId, 'remembered-device');
});

test('client reuses a remembered DSM device without submitting the stale OTP', async () => {
  let loginBody;
  const client = new SynologyClient(
    normalizeConfig({
      url: 'https://nas:5001',
      username: 'gladys',
      password: 'password',
      otp_code: '123456',
    }),
    {
      mfaDeviceStore: {
        async load() {
          return 'remembered-device';
        },
        async save() {},
      },
      fetchImpl: async (_url, options) => {
        const body = Object.fromEntries(options.body.entries());
        if (body.api === 'SYNO.API.Info') {
          return jsonResponse({
            success: true,
            data: { 'SYNO.API.Auth': { path: 'entry.cgi', minVersion: 3, maxVersion: 7 } },
          });
        }
        loginBody = body;
        return jsonResponse({ success: true, data: { sid: 'sid' } });
      },
    },
  );

  await client.login();
  assert.equal(loginBody.device_id, 'remembered-device');
  assert.equal(loginBody.device_name, 'Gladys Synology');
  assert.equal(loginBody.otp_code, undefined);
  assert.equal(loginBody.enable_device_token, undefined);
});

test('client renews a revoked remembered device with a fresh OTP', async () => {
  const loginCalls = [];
  const saved = [];
  const client = new SynologyClient(
    normalizeConfig({
      url: 'https://nas:5001',
      username: 'gladys',
      password: 'password',
      otp_code: '654321',
    }),
    {
      mfaDeviceStore: {
        async load() {
          return 'revoked-device';
        },
        async save(_config, deviceId) {
          saved.push(deviceId);
        },
      },
      fetchImpl: async (_url, options) => {
        const body = Object.fromEntries(options.body.entries());
        if (body.api === 'SYNO.API.Info') {
          return jsonResponse({
            success: true,
            data: { 'SYNO.API.Auth': { path: 'entry.cgi', minVersion: 3, maxVersion: 7 } },
          });
        }
        loginCalls.push(body);
        return loginCalls.length === 1
          ? jsonResponse({ success: false, error: { code: 406 } })
          : jsonResponse({ success: true, data: { sid: 'sid', did: 'renewed-device' } });
      },
    },
  );

  await client.login();
  assert.equal(loginCalls.length, 2);
  assert.equal(loginCalls[0].device_id, 'revoked-device');
  assert.equal(loginCalls[1].otp_code, '654321');
  assert.equal(loginCalls[1].enable_device_token, 'yes');
  assert.deepEqual(saved, ['renewed-device']);
});

test('client signs in again when DSM rejects a remembered device after a NAS update', async () => {
  const loginCalls = [];
  const saved = [];
  const client = new SynologyClient(
    normalizeConfig({
      url: 'https://nas:5001',
      username: 'gladys',
      password: 'password',
      otp_code: '111222',
    }),
    {
      mfaDeviceStore: {
        async load() {
          return 'stale-device';
        },
        async save(_config, deviceId) {
          saved.push(deviceId);
        },
      },
      fetchImpl: async (_url, options) => {
        const body = Object.fromEntries(options.body.entries());
        if (body.api === 'SYNO.API.Info') {
          return jsonResponse({
            success: true,
            data: { 'SYNO.API.Auth': { path: 'entry.cgi', minVersion: 3, maxVersion: 7 } },
          });
        }
        loginCalls.push(body);
        return loginCalls.length === 1
          ? jsonResponse({ success: false, error: { code: 498 } })
          : jsonResponse({ success: true, data: { sid: 'sid', did: 'fresh-device' } });
      },
    },
  );

  await client.login();
  assert.equal(loginCalls.length, 2);
  assert.equal(loginCalls[0].device_id, 'stale-device');
  assert.equal(loginCalls[1].device_id, undefined);
  assert.equal(loginCalls[1].otp_code, '111222');
  assert.deepEqual(saved, ['fresh-device']);
  assert.equal(client.sid, 'sid');
});

test('client does not retry a remembered device login when the credentials are refused', async () => {
  const loginCalls = [];
  const client = new SynologyClient(
    normalizeConfig({ url: 'https://nas:5001', username: 'gladys', password: 'password' }),
    {
      mfaDeviceStore: {
        async load() {
          return 'remembered-device';
        },
        async save() {},
      },
      fetchImpl: async (_url, options) => {
        const body = Object.fromEntries(options.body.entries());
        if (body.api === 'SYNO.API.Info') {
          return jsonResponse({
            success: true,
            data: { 'SYNO.API.Auth': { path: 'entry.cgi', minVersion: 3, maxVersion: 7 } },
          });
        }
        loginCalls.push(body);
        return jsonResponse({ success: false, error: { code: 400 } });
      },
    },
  );

  await assert.rejects(client.login(), /Invalid DSM credentials/);
  assert.equal(loginCalls.length, 1);
});

test('client renews the DSM session when a call fails with error 498', async () => {
  const calls = [];
  const client = new SynologyClient(
    normalizeConfig({ url: 'https://nas:5001', username: 'gladys', password: 'password' }),
    {
      mfaDeviceStore: {
        async load() {
          return null;
        },
        async save() {},
      },
      fetchImpl: async (_url, options) => {
        const body = Object.fromEntries(options.body.entries());
        calls.push(body);
        if (body.api === 'SYNO.API.Info') {
          return jsonResponse({
            success: true,
            data: {
              'SYNO.API.Auth': { path: 'entry.cgi', minVersion: 3, maxVersion: 7 },
              'SYNO.Core.System': { path: 'entry.cgi', minVersion: 1, maxVersion: 3 },
            },
          });
        }
        if (body.method === 'login') {
          return jsonResponse({ success: true, data: { sid: `sid-${calls.length}` } });
        }
        return calls.filter((call) => call.api === 'SYNO.Core.System').length === 1
          ? jsonResponse({ success: false, error: { code: 498 } })
          : jsonResponse({ success: true, data: { model: 'DS920+' } });
      },
    },
  );

  const data = await client.call('SYNO.Core.System', 'info', {}, { preferredVersion: 3 });
  assert.deepEqual(data, { model: 'DS920+' });
  assert.equal(calls.filter((call) => call.method === 'login').length, 2);
});

test('client fails fast when DSM accepts the connection but never answers', async () => {
  const client = new SynologyClient(
    normalizeConfig({ url: 'https://nas', username: 'gladys', password: 'password' }),
    {
      requestTimeoutMs: 50,
      // Mimics undici: the abort signal rejects the fetch with a TimeoutError cause. The extra
      // timer stands for the pending socket, which alone keeps the event loop alive.
      fetchImpl: (url, options) =>
        new Promise((resolve, reject) => {
          const pending = setTimeout(() => resolve(jsonResponse({ success: true })), 5_000);
          options.signal.addEventListener('abort', () => {
            clearTimeout(pending);
            const error = new TypeError('fetch failed');
            error.cause = options.signal.reason;
            reject(error);
          });
        }),
    },
  );

  await assert.rejects(client.discoverApis(), /Synology DSM did not answer within \ds/);
});

test('client sends a single login when concurrent calls hit an expired session', async () => {
  let logins = 0;
  let expired = true;
  const apiData = {
    'SYNO.API.Auth': { path: 'auth.cgi', minVersion: 1, maxVersion: 7 },
    'SYNO.Core.System': { path: 'entry.cgi', minVersion: 1, maxVersion: 3 },
    'SYNO.Core.System.Utilization': { path: 'entry.cgi', minVersion: 1, maxVersion: 1 },
    'SYNO.Storage.CGI.Storage': { path: 'entry.cgi', minVersion: 1, maxVersion: 1 },
  };
  const fetchImpl = async (url, options) => {
    const body = Object.fromEntries(options.body.entries());
    if (body.api === 'SYNO.API.Info') return jsonResponse({ success: true, data: apiData });
    if (body.method === 'login') {
      logins += 1;
      await Promise.resolve();
      return jsonResponse({ success: true, data: { sid: `session-${logins}` } });
    }
    if (expired && body._sid === 'session-1') {
      return jsonResponse({ success: false, error: { code: 106 } });
    }
    return jsonResponse({ success: true, data: { ok: true } });
  };
  const client = new SynologyClient(
    normalizeConfig({ url: 'https://nas', username: 'gladys', password: 'password' }),
    { fetchImpl },
  );

  await client.login();
  expired = true;
  await Promise.all([
    client.call('SYNO.Core.System', 'info'),
    client.call('SYNO.Core.System.Utilization', 'get'),
    client.call('SYNO.Storage.CGI.Storage', 'load_info'),
  ]);

  // One login for the initial session, one shared by the three calls that found it expired.
  assert.equal(logins, 2);
  assert.equal(client.sid, 'session-2');
});

test('client signs in even when the trusted device store is unusable', async () => {
  const fetchImpl = async (url, options) => {
    const body = Object.fromEntries(options.body.entries());
    if (body.api === 'SYNO.API.Info') {
      return jsonResponse({
        success: true,
        data: { 'SYNO.API.Auth': { path: 'auth.cgi', minVersion: 1, maxVersion: 7 } },
      });
    }
    return jsonResponse({ success: true, data: { sid: 'secret-session', did: 'device-token' } });
  };
  const mfaDeviceStore = {
    async load() {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    },
    async save() {
      throw Object.assign(new Error('read-only file system'), { code: 'EROFS' });
    },
  };
  const client = new SynologyClient(
    normalizeConfig({ url: 'https://nas', username: 'gladys', password: 'password' }),
    { fetchImpl, mfaDeviceStore },
  );

  const data = await client.login();
  assert.equal(data.sid, 'secret-session');
  assert.equal(client.sid, 'secret-session');
});
