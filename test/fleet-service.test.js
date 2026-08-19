import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeConfig } from '../src/config.js';
import { SynologyFleetService } from '../src/fleet-service.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

function snapshot(serial, model) {
  return {
    system: { serial, model, firmware_ver: 'DSM 7.2.2' },
    utilization: { cpu: { total_load: 10 }, memory: { real_usage: 20 } },
    storage: { volumes: [] },
    hyperBackup: null,
    activeBackup: null,
  };
}

test('fleet service discovers and publishes states for multiple NAS connections', async () => {
  const config = normalizeConfig({
    url: 'https://nas1',
    username: 'one',
    password: 'password-one',
    nas_2_url: 'https://nas2',
    nas_2_username: 'two',
    nas_2_password: 'password-two',
  });
  const gladys = createFakeGladys();
  const fleet = new SynologyFleetService(config, {
    clientFactory: (nasConfig) => ({
      async getSnapshot() {
        return nasConfig.url.endsWith('nas1')
          ? snapshot('SERIAL-1', 'NAS One')
          : snapshot('SERIAL-2', 'NAS Two');
      },
      async close() {},
    }),
  });

  const devices = await fleet.discover(gladys);
  assert.deepEqual(
    devices.map((device) => device.name),
    ['NAS One', 'NAS Two'],
  );
  await fleet.publishStates(gladys, { force: true });
  assert.ok(
    gladys.published.some((state) =>
      state.device_feature_external_id.startsWith('synology-nas:SERIAL-1:'),
    ),
  );
  assert.ok(
    gladys.published.some((state) =>
      state.device_feature_external_id.startsWith('synology-nas:SERIAL-2:'),
    ),
  );
});

test('fleet service keeps healthy NAS connections available when another one fails', async () => {
  const config = normalizeConfig({
    url: 'https://nas1',
    username: 'one',
    password: 'password-one',
    nas_2_url: 'https://nas2',
    nas_2_username: 'two',
    nas_2_password: 'password-two',
  });
  const fleet = new SynologyFleetService(config, {
    clientFactory: (nasConfig) => ({
      async getSnapshot() {
        if (nasConfig.url.endsWith('nas2')) throw new Error('NAS Two unavailable');
        return snapshot('SERIAL-1', 'NAS One');
      },
      async close() {},
    }),
  });

  const devices = await fleet.discover(createFakeGladys());
  assert.equal(devices.length, 1);
  assert.equal(fleet.lastFailures.length, 1);
});
