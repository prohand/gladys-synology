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
      disks: [
        { id: 'disk_1', name: 'Drive 1', model: 'WD40EFRX', smart_status: 'normal', temp: 38 },
        { id: 'disk_2', name: 'Drive 2', model: 'WD40EFRX', smart_status: 'failing' },
      ],
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
  assert.deepEqual(snapshot.disks, [
    { id: 'disk_1', name: 'Drive 1', smartStatus: 'normal', smartHealthy: 1, temperature: 38 },
    {
      id: 'disk_2',
      name: 'Drive 2',
      smartStatus: 'failing',
      smartHealthy: 0,
      temperature: undefined,
    },
  ]);
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
          last_result: { status: 2, time_end: 1_700_000_100 },
          versions: [{ status: 3, time_end: 1_700_000_100 }],
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

test('normalizeSnapshot maps a partially successful Active Backup result', () => {
  const snapshot = normalizeSnapshot({
    activeBackup: {
      tasks: [
        {
          task_id: 10,
          task_name: 'Mail server',
          last_result: { status: 3, time_start: 1_700_000_200 },
        },
      ],
    },
  });

  assert.equal(snapshot.backups[0].result, 'partial success');
  assert.equal(snapshot.backups[0].lastBackupAt, '2023-11-14T22:16:40.000Z');
});

test('normalizeSnapshot tolerates missing optional storage API data', () => {
  const snapshot = normalizeSnapshot({ system: {}, utilization: {}, storage: null });
  assert.deepEqual(snapshot.volumes, []);
  assert.deepEqual(snapshot.disks, []);
});

test('normalizeSnapshot does not claim an unknown SMART status is unhealthy', () => {
  const snapshot = normalizeSnapshot({
    storage: { disks: [{ id: 'disk_1', smart_status: 'not_supported' }] },
  });
  assert.equal(snapshot.disks[0].smartStatus, 'not_supported');
  assert.equal(snapshot.disks[0].smartHealthy, undefined);
});

test('normalizeSnapshot only judges volume health on known DSM statuses', () => {
  const statuses = normalizeSnapshot({
    storage: {
      volumes: [
        { id: 'v1', status: 'normal' },
        { id: 'v2', status: 'crashed' },
        { id: 'v3', status: 'attention' },
        { id: 'v4', status: 'background_scrubbing' },
        { id: 'v5', status: 'expanding' },
      ],
    },
  }).volumes.map((volume) => volume.healthy);

  // A maintenance state is neither healthy nor a failure: publishing 0 would raise a false alarm.
  assert.deepEqual(statuses, [1, 0, 0, undefined, undefined]);
});

test('bytesToGigabytes rounds to two decimals', () => {
  assert.equal(bytesToGigabytes(5 * 1024 ** 3 + 512 * 1024 ** 2), 5.5);
  assert.equal(bytesToGigabytes(undefined), undefined);
});
