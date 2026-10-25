import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getBackupStatus, getNasStatus, getVolumeStatus, wakeNas } from '../src/scene-actions.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createFleet, dsmNetwork, rawDsmSnapshot } from './helpers/fleet.js';

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

test('waking a NAS read since the start uses the MAC address of its snapshot', async () => {
  const gladys = createFakeGladys();
  const fleet = await readyFleet([rawDsmSnapshot({ network: dsmNetwork() })]);
  // Any device of the NAS names it, like the other actions.
  assert.deepEqual(await wakeNas(fleet, gladys, { device: 'synology-disk:ABC123:sata1' }), {
    mac_address: '00:11:32:ab:cd:ef',
  });
  assert.deepEqual(await wakeNas(fleet, gladys, {}), { mac_address: '00:11:32:ab:cd:ef' });
  assert.deepEqual(
    gladys.wakes.map((wake) => wake.mac),
    ['00:11:32:ab:cd:ef', '00:11:32:ab:cd:ef'],
  );
  // Waking is no reason to fire a scene event.
  assert.deepEqual(gladys.sceneEvents, []);
});

test('a NAS asleep since the start is woken through the MAC stored on its Gladys device', async () => {
  const gladys = createFakeGladys();
  gladys.devices = [
    { external_id: 'synology-volume:ABC123:volume_1' },
    {
      external_id: 'synology-nas:ABC123',
      params: [{ name: 'MAC_ADDRESS', value: '00:11:32:ab:cd:ef' }],
    },
  ];
  const fleet = createFleet([[new Error('ETIMEDOUT')]]);
  await assert.rejects(fleet.refresh());
  assert.deepEqual(await wakeNas(fleet, gladys, { device: 'synology-nas:ABC123' }), {
    mac_address: '00:11:32:ab:cd:ef',
  });
  // Without a device, the single NAS Gladys knows a MAC address for stands in.
  assert.deepEqual(await wakeNas(fleet, gladys, {}), { mac_address: '00:11:32:ab:cd:ef' });
  assert.equal(gladys.wakes.length, 2);
});

test('waking refuses to guess a MAC address it does not know', async () => {
  const gladys = createFakeGladys();
  const fleet = await readyFleet();
  // DSM did not give the network settings, and no device carries the param.
  await assert.rejects(wakeNas(fleet, gladys, {}), /MAC address of this NAS is unknown/);
  // Two NAS known, none selected: which one to wake is not ours to pick.
  gladys.devices = [
    {
      external_id: 'synology-nas:A',
      params: [{ name: 'MAC_ADDRESS', value: '00:11:32:00:00:01' }],
    },
    {
      external_id: 'synology-nas:B',
      params: [{ name: 'MAC_ADDRESS', value: '00:11:32:00:00:02' }],
    },
  ];
  const asleep = createFleet([[new Error('ETIMEDOUT')], [new Error('ETIMEDOUT')]]);
  await assert.rejects(asleep.refresh());
  await assert.rejects(wakeNas(asleep, gladys, {}), /unknown/);
  // A volume of a NAS asleep since the start cannot be mapped back to it.
  await assert.rejects(
    wakeNas(asleep, gladys, { device: 'synology-volume:A:volume_1' }),
    /unknown/,
  );
  assert.deepEqual(gladys.wakes, []);
});

test('a refused wake (permission, rate limit) fails the action', async () => {
  const gladys = createFakeGladys();
  gladys.wakeOnLan = async () => {
    throw new Error('403 network_wake not declared');
  };
  const fleet = await readyFleet([rawDsmSnapshot({ network: dsmNetwork() })]);
  await assert.rejects(wakeNas(fleet, gladys, {}), /403/);
});
