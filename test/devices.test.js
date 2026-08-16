import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEVICE_FEATURE_CATEGORIES } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from '../src/config.js';
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
    receiveRate: 30,
    transmitRate: 40,
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
  const devices = buildDiscoveredDevices(gladys, 'ABC123', snapshot, normalizeConfig());
  assert.equal(devices.length, 2);
  assert.equal(devices[0].poll_frequency, 60);
  assert.equal(devices[1].poll_frequency, undefined);
  assert.equal(new Set(devices.map((device) => device.external_id)).size, 2);
});

test('discovery uses canonical Gladys categories for temperature, data and rates', () => {
  const devices = buildDiscoveredDevices(gladys, 'ABC123', snapshot, normalizeConfig());
  const categories = devices.flatMap((device) =>
    device.features.map((feature) => feature.category),
  );
  assert.ok(categories.includes(DEVICE_FEATURE_CATEGORIES.DEVICE_TEMPERATURE_SENSOR));
  assert.ok(categories.includes(DEVICE_FEATURE_CATEGORIES.DATARATE));
  assert.ok(categories.includes(DEVICE_FEATURE_CATEGORIES.DATA));
});

test('states use the same stable feature IDs as discovery', () => {
  const devices = buildDiscoveredDevices(gladys, 'ABC123', snapshot, normalizeConfig());
  const featureIds = new Set(
    devices.flatMap((device) => device.features.map((f) => f.external_id)),
  );
  const states = buildStates(gladys, 'ABC123', snapshot);
  assert.ok(states.length > 0);
  for (const state of states) assert.ok(featureIds.has(state.device_feature_external_id));
});

test('undefined optional values are not published', () => {
  const states = buildStates(gladys, 'ABC123', {
    nas: { model: 'NAS', dsmVersion: '', receiveRate: 0, transmitRate: 0 },
    volumes: [],
  });
  assert.equal(states.length, 2);
  assert.ok(states.every((state) => state.state === 0));
});
