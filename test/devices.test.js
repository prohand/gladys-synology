import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEVICE_FEATURE_CATEGORIES } from '@gladysassistant/integration-sdk';
import { buildDiscoveredDevices, buildStates } from '../src/devices/index.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const gladys = createFakeGladys();
const snapshot = {
  nas: {
    serial: 'ABC123',
    model: 'DS920+',
    dsmVersion: 'DSM 7.2.2',
    temperature: 41,
    uptime: 300,
    cpuUsage: 10,
    memoryUsage: 20,
  },
  volumes: [
    {
      id: 'volume_1',
      name: 'Volume 1',
      healthy: 1,
      usagePercent: 25,
      usedBytes: 25 * 1024 ** 3,
      freeBytes: 75 * 1024 ** 3,
      totalBytes: 100 * 1024 ** 3,
    },
  ],
};

test('discovery creates one NAS and one device per volume', () => {
  const devices = buildDiscoveredDevices(gladys, 'ABC123', snapshot);
  assert.equal(devices.length, 2);
  assert.equal(devices[0].poll_frequency, undefined);
  assert.equal(devices[1].poll_frequency, undefined);
  assert.equal(new Set(devices.map((device) => device.external_id)).size, 2);
});

test('discovery uses canonical Gladys categories for levels, temperature and data', () => {
  const devices = buildDiscoveredDevices(gladys, 'ABC123', snapshot);
  const categories = devices.flatMap((device) =>
    device.features.map((feature) => feature.category),
  );
  assert.ok(categories.includes(DEVICE_FEATURE_CATEGORIES.LEVEL_SENSOR));
  assert.ok(categories.includes(DEVICE_FEATURE_CATEGORIES.DEVICE_TEMPERATURE_SENSOR));
  assert.ok(categories.includes(DEVICE_FEATURE_CATEGORIES.DATA));
});

test('discovery does not expose network traffic features', () => {
  const devices = buildDiscoveredDevices(gladys, 'ABC123', snapshot);
  const featureIds = devices.flatMap((device) =>
    device.features.map((feature) => feature.external_id),
  );
  assert.ok(featureIds.every((id) => !id.includes('network-')));
});

test('every discovered feature includes the numeric bounds required by Gladys', () => {
  const devices = buildDiscoveredDevices(gladys, 'ABC123', snapshot);
  for (const feature of devices.flatMap((device) => device.features)) {
    assert.equal(Number.isFinite(feature.min), true, `${feature.external_id} min`);
    assert.equal(Number.isFinite(feature.max), true, `${feature.external_id} max`);
  }
});

test('states use the same stable feature IDs as discovery', () => {
  const devices = buildDiscoveredDevices(gladys, 'ABC123', snapshot);
  const featureIds = new Set(
    devices.flatMap((device) => device.features.map((f) => f.external_id)),
  );
  const states = buildStates(gladys, 'ABC123', snapshot);
  assert.ok(states.length > 0);
  for (const state of states) assert.ok(featureIds.has(state.device_feature_external_id));
});

test('DSM version is published through the Gladys text field', () => {
  const states = buildStates(gladys, 'ABC123', snapshot);
  const version = states.find((item) => item.device_feature_external_id.endsWith(':dsm-version'));
  assert.deepEqual(version, {
    device_feature_external_id: 'synology-nas:ABC123:dsm-version',
    text: 'DSM 7.2.2',
  });
});

test('undefined optional values are not published', () => {
  const states = buildStates(gladys, 'ABC123', {
    nas: { model: 'NAS', dsmVersion: '', cpuUsage: 0, memoryUsage: 0 },
    volumes: [],
  });
  assert.equal(states.length, 2);
  assert.ok(states.every((state) => state.state === 0));
});
