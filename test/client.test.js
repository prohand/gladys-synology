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
