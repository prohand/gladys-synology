import test from 'node:test';
import assert from 'node:assert/strict';
import { metricsToDevices } from '../src/features.js';

test('metrics become stable Gladys devices', () => {
  const devices = metricsToDevices({ hostname: 'Mon NAS', model: 'DS', cpuPercent: 10, memoryPercent: 20, disks: [{ id: 'sda', name: 'Drive', smartStatus: 'normal', temperature: 30 }], volumes: [{ id: 'volume_1', name: 'Volume 1', status: 'normal', freeBytes: 500, usedPercent: 50 }], backups: [] });
  assert.deepEqual(devices.map((device) => device.id), ['synology:mon-nas:system', 'synology:mon-nas:disk:sda', 'synology:mon-nas:volume:volume-1']);
  assert.equal(devices[1].features.find((feature) => feature.id === 'smart').value, 1);
});
