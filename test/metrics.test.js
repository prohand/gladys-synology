import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bytesToGigabytes, normalizeSnapshot } from '../src/synology/metrics.js';

test('normalizeSnapshot converts DSM system, utilization and storage shapes', () => {
  const snapshot = normalizeSnapshot({
    system: {
      serial: 'ABC123',
      model: 'DS920+',
      firmware_ver: 'DSM 7.2.2',
      sys_temp: 42,
      up_time: 12345,
    },
    utilization: {
      cpu: { user_load: 8, system_load: 4, other_load: 1 },
      memory: { real_usage: 37 },
      network: [
        { device: 'eth0', rx: 1000, tx: 500 },
        { device: 'eth1', rx: 2000, tx: 750 },
      ],
    },
    storage: {
      volumes: [
        {
          id: 'volume_1',
          display_name: 'Volume 1',
          status: 'normal',
          total_size: 1000,
          used_size: 250,
        },
      ],
    },
  });

  assert.deepEqual(snapshot.nas, {
    serial: 'ABC123',
    model: 'DS920+',
    dsmVersion: 'DSM 7.2.2',
    temperature: 42,
    uptime: 12345,
    cpuUsage: 13,
    memoryUsage: 37,
  });
  assert.equal(snapshot.volumes[0].usagePercent, 25);
  assert.equal(snapshot.volumes[0].freeBytes, 750);
  assert.equal(snapshot.volumes[0].healthy, 1);
});

test('normalizeSnapshot tolerates missing optional storage API data', () => {
  assert.deepEqual(normalizeSnapshot({ system: {}, utilization: {}, storage: null }).volumes, []);
});

test('bytesToGigabytes rounds to two decimals', () => {
  assert.equal(bytesToGigabytes(5 * 1024 ** 3 + 512 * 1024 ** 2), 5.5);
  assert.equal(bytesToGigabytes(undefined), undefined);
});
