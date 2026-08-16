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
    cpuUsage: 13,
    memoryUsage: 37,
  });
  assert.deepEqual(snapshot.backups, []);
  assert.equal(snapshot.volumes[0].usagePercent, 25);
  assert.equal(snapshot.volumes[0].freeBytes, 750);
  assert.equal(snapshot.volumes[0].healthy, 1);
});

test('normalizeSnapshot rounds volume usage to two decimal places', () => {
  const snapshot = normalizeSnapshot({
    storage: { volumes: [{ total_size: 3, used_size: 1 }] },
  });
  assert.equal(snapshot.volumes[0].usagePercent, 33.33);
});

test('normalizeSnapshot exposes Hyper Backup and Active Backup task information', () => {
  const snapshot = normalizeSnapshot({
    hyperBackup: {
      task_list: [
        {
          task_id: 7,
          name: 'Cloud archive',
          state: 'backupable',
          last_bkp_result: 'success',
          last_bkp_time: 1_700_000_000,
        },
      ],
    },
    activeBackup: {
      tasks: [
        {
          task_id: 9,
          task_name: 'Workstations',
          status: 'idle',
          versions: [{ status: 3, backup_time: 1_700_000_100 }],
        },
      ],
    },
  });

  assert.deepEqual(snapshot.backups, [
    {
      id: '7',
      provider: 'hyper-backup',
      name: 'Cloud archive',
      status: 'backupable',
      result: 'success',
      lastBackupAt: '2023-11-14T22:13:20.000Z',
    },
    {
      id: '9',
      provider: 'active-backup',
      name: 'Workstations',
      status: 'idle',
      result: 'success',
      lastBackupAt: '2023-11-14T22:15:00.000Z',
    },
  ]);
});

test('normalizeSnapshot tolerates missing optional storage API data', () => {
  assert.deepEqual(normalizeSnapshot({ system: {}, utilization: {}, storage: null }).volumes, []);
});

test('bytesToGigabytes rounds to two decimals', () => {
  assert.equal(bytesToGigabytes(5 * 1024 ** 3 + 512 * 1024 ** 2), 5.5);
  assert.equal(bytesToGigabytes(undefined), undefined);
});
