import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SynologyMfaDeviceStore } from '../src/synology/mfa-device-store.js';

test('MFA device store persists a token only for the matching DSM account', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gladys-synology-mfa-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'device.json');
  const store = new SynologyMfaDeviceStore(filePath);
  const account = { url: 'https://nas:5001', username: 'gladys' };

  assert.equal(await store.load(account), null);
  await Promise.all([
    store.save(account, 'device-token'),
    new SynologyMfaDeviceStore(filePath).save(
      { url: 'https://nas2:5001', username: 'backup' },
      'second-token',
    ),
  ]);
  assert.equal(await store.load(account), 'device-token');
  assert.equal(await store.load({ url: 'https://nas2:5001', username: 'backup' }), 'second-token');
  assert.equal(await store.load({ ...account, username: 'other' }), null);

  const persisted = JSON.parse(await readFile(filePath, 'utf8'));
  assert.deepEqual(persisted, [
    { ...account, device_id: 'device-token' },
    { url: 'https://nas2:5001', username: 'backup', device_id: 'second-token' },
  ]);
  assert.ok(persisted.every((record) => !Object.hasOwn(record, 'password')));
});
