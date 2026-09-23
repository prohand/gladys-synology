import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getBackupStatus, getNasStatus, getVolumeStatus } from '../src/scene-actions.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createFleet, rawDsmSnapshot } from './helpers/fleet.js';

async function readyFleet(readings = [rawDsmSnapshot()], config) {
  const fleet = createFleet([readings], config);
  await fleet.refresh();
  return fleet;
}

test('the NAS status reads DSM again and counts the problems', async () => {
  const gladys = createFakeGladys();
  const fleet = await readyFleet();
  assert.deepEqual(await getNasStatus(fleet, gladys, {}), {
    reachable: true,
    model: 'DS920+',
    dsm_version: 'DSM 7.2.2-72806',
    cpu_usage: 12,
    memory_usage: 41,
    temperature: 48,
    unhealthy_volumes: 1,
    unhealthy_disks: 1,
    failed_backups: 1,
    problems: 'Volume 2 (crashed), Drive 2 (failing), USB copy (failed)',
  });
});

test('an unreachable NAS is an answer the scene can gate on, not a failure', async () => {
  const gladys = createFakeGladys();
  const fleet = await readyFleet([rawDsmSnapshot(), new Error('ETIMEDOUT')]);
  assert.deepEqual(await getNasStatus(fleet, gladys, { device: 'synology-disk:ABC123:sata1' }), {
    reachable: false,
    model: 'DS920+',
    dsm_version: 'DSM 7.2.2-72806',
  });
});

test('the volume status reports health and space in GB', async () => {
  const gladys = createFakeGladys();
  const fleet = await readyFleet();
  assert.deepEqual(
    await getVolumeStatus(fleet, gladys, { device: 'synology-volume:ABC123:volume_1' }),
    {
      volume_name: 'Volume 1',
      status: 'normal',
      healthy: true,
      usage_percent: 95,
      used_gb: 3891.2,
      free_gb: 204.8,
      total_gb: 4096,
    },
  );
  const crashed = await getVolumeStatus(fleet, gladys, {
    device: 'synology-volume:ABC123:volume_2',
  });
  assert.equal(crashed.healthy, false);
});

test('the backup status tells how long ago the task ran, in the configured date format', async () => {
  const gladys = createFakeGladys();
  const fleet = await readyFleet([rawDsmSnapshot()], { date_format: 'iso' });
  assert.deepEqual(
    await getBackupStatus(fleet, gladys, { device: 'synology-backup:ABC123:hyper-backup:7' }),
    {
      task_name: 'Cloud archive',
      provider_name: 'Hyper Backup',
      status: undefined,
      result: 'done',
      outcome: 'success',
      last_backup: '2026-09-21T14:13:20.000Z',
      hours_since_last_backup: 45.8,
    },
  );
});

test('an action refuses a device of the wrong kind or a task gone from the NAS', async () => {
  const gladys = createFakeGladys();
  const fleet = await readyFleet([
    rawDsmSnapshot(),
    rawDsmSnapshot({ hyperBackup: { task_list: [] } }),
  ]);
  await assert.rejects(
    getVolumeStatus(fleet, gladys, { device: 'synology-disk:ABC123:sata1' }),
    /not a Synology volume/,
  );
  await assert.rejects(
    getNasStatus(fleet, gladys, { device: 'synology-nas:UNKNOWN' }),
    /not a Synology NAS/,
  );
  await assert.rejects(
    getBackupStatus(fleet, gladys, { device: 'synology-backup:ABC123:hyper-backup:7' }),
    /"Cloud archive" no longer exists/,
  );
});
