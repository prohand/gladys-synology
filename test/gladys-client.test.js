import test from 'node:test';
import assert from 'node:assert/strict';
import { GladysClient } from '../src/gladys-client.js';

test('Gladys client creates a device then publishes its state', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/device?')) return { ok: true, status: 200, json: async () => [] };
    if (url.endsWith('/device')) return { ok: true, status: 201, json: async () => ({ selector: 'nas', features: [{ external_id: 'nas:cpu', selector: 'cpu' }] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const client = new GladysClient({ baseUrl: 'http://gladys', token: 'secret', fetchImpl });
  await client.publish({ id: 'nas', name: 'NAS', features: [{ id: 'cpu', name: 'CPU', value: 42 }] });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[2].url, 'http://gladys/api/v1/device/nas/feature/cpu/state');
  assert.deepEqual(JSON.parse(calls[2].options.body), { value: 42 });
  assert.equal(calls[2].options.headers.authorization, 'Bearer secret');
});
