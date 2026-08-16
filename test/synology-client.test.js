import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMetrics, SynologyClient } from '../src/synology-client.js';

test('normalizeMetrics handles DSM storage shapes', () => {
  const metrics = normalizeMetrics({
    system: { hostname: 'NAS', model: 'DS923+', temperature: 42 },
    utilization: { cpu: { user_load: 12 }, memory: { real_usage: 34 } },
    storage: { disks: [{ id: 'sda', model: 'Disk', smart_status: 'normal', temp: 31 }], volumes: [{ id: 'volume_1', size: { total: 1000, used: 250 } }] },
    backups: { tasks: [{ id: 1, name: 'Cloud', status: 'success', last_bkp_time: 123 }] },
  });
  assert.equal(metrics.cpuPercent, 12);
  assert.equal(metrics.volumes[0].freeBytes, 750);
  assert.equal(metrics.volumes[0].usedPercent, 25);
  assert.equal(metrics.disks[0].smartStatus, 'normal');
  assert.equal(metrics.backups[0].name, 'Cloud');
});

test('client authenticates and adds the sid to API calls', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes('query.cgi')) return { ok: true, json: async () => ({ success: true, data: {
      'SYNO.API.Auth': { path: 'auth.cgi', maxVersion: 7 }, 'SYNO.Core.System': { path: 'entry.cgi', maxVersion: 1 },
    } }) };
    if (url.includes('auth.cgi')) return { ok: true, json: async () => ({ success: true, data: { sid: 'secret-sid' } }) };
    return { ok: true, json: async () => ({ success: true, data: { hostname: 'NAS' } }) };
  };
  const client = new SynologyClient({ baseUrl: 'https://nas', username: 'u', password: 'p', fetchImpl });
  const info = await client.call('SYNO.Core.System', 'info');
  assert.equal(info.hostname, 'NAS');
  assert.match(urls.at(-1), /_sid=secret-sid/);
  assert.doesNotMatch(urls.at(-1), /passwd/);
});
