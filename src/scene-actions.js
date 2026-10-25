import { backupProviderName } from './devices/backup.js';
import { MAC_ADDRESS_PARAM } from './devices/system.js';
import { formatDate } from './date-format.js';
import { bytesToGigabytes } from './synology/metrics.js';

/** Keys of the manifest `scene_actions`. A published key is never renamed. */
export const SCENE_ACTION = {
  NAS_STATUS: 'get_nas_status',
  VOLUME_STATUS: 'get_volume_status',
  BACKUP_STATUS: 'get_backup_status',
  WAKE_NAS: 'wake_nas',
};

function booleanHealth(value) {
  return value === undefined ? undefined : value === 1;
}

function resolveTarget(fleet, gladys, externalId, kind) {
  const target = fleet.resolve(gladys, externalId);
  if (!target || (kind && target.kind !== kind)) {
    throw new Error(`The selected device is not a Synology ${kind ?? 'NAS'} of this integration.`);
  }
  return target;
}

// Every action reads DSM again: a scene usually runs long after the last scheduled refresh.
async function refreshedItem(target, collection) {
  const snapshot = await target.service.refresh();
  const item = snapshot[collection].find(
    (entry) => entry.id === target.item.id && entry.provider === target.item.provider,
  );
  if (!item) throw new Error(`"${target.item.name}" no longer exists on the NAS.`);
  return item;
}

function problems(snapshot) {
  return [
    ...snapshot.volumes
      .filter((volume) => volume.healthy === 0)
      .map((volume) => `${volume.name} (${volume.status})`),
    ...snapshot.disks
      .filter((disk) => disk.smartHealthy === 0)
      .map((disk) => `${disk.name} (${disk.smartStatus})`),
    ...snapshot.backups
      .filter((backup) => backup.outcome === 'failure')
      .map((backup) => `${backup.name} (${backup.result})`),
  ].join(', ');
}

/**
 * State of one NAS. An unreachable NAS is an answer, not a failure: `reachable` lets the scene
 * author gate on it, where a thrown error would only be logged.
 */
export async function getNasStatus(fleet, gladys, fields = {}) {
  const { service } = resolveTarget(fleet, gladys, fields.device);
  let snapshot;
  try {
    snapshot = await service.refresh();
  } catch {
    return {
      reachable: false,
      model: service.snapshot?.nas.model,
      dsm_version: service.snapshot?.nas.dsmVersion || undefined,
    };
  }
  return {
    reachable: true,
    model: snapshot.nas.model,
    dsm_version: snapshot.nas.dsmVersion || undefined,
    cpu_usage: snapshot.nas.cpuUsage,
    memory_usage: snapshot.nas.memoryUsage,
    temperature: snapshot.nas.temperature,
    unhealthy_volumes: snapshot.volumes.filter((volume) => volume.healthy === 0).length,
    unhealthy_disks: snapshot.disks.filter((disk) => disk.smartHealthy === 0).length,
    failed_backups: snapshot.backups.filter((backup) => backup.outcome === 'failure').length,
    problems: problems(snapshot),
  };
}

export async function getVolumeStatus(fleet, gladys, fields = {}) {
  const target = resolveTarget(fleet, gladys, fields.device, 'volume');
  const volume = await refreshedItem(target, 'volumes');
  return {
    volume_name: volume.name,
    status: volume.status,
    healthy: booleanHealth(volume.healthy),
    usage_percent: volume.usagePercent,
    used_gb: bytesToGigabytes(volume.usedBytes),
    free_gb: bytesToGigabytes(volume.freeBytes),
    total_gb: bytesToGigabytes(volume.totalBytes),
  };
}

export async function getBackupStatus(fleet, gladys, fields = {}) {
  const target = resolveTarget(fleet, gladys, fields.device, 'backup');
  const backup = await refreshedItem(target, 'backups');
  const { service } = target;
  const lastBackup = backup.lastBackupAt ? new Date(backup.lastBackupAt).getTime() : NaN;
  return {
    task_name: backup.name,
    provider_name: backupProviderName(backup.provider),
    status: backup.status,
    result: backup.result,
    outcome: backup.outcome,
    last_backup: formatDate(backup.lastBackupAt, service.config.date_format),
    hours_since_last_backup: Number.isFinite(lastBackup)
      ? Math.round((service.now() - lastBackup) / 360_000) / 10
      : undefined,
  };
}

function macParam(device) {
  return device?.params?.find((param) => param.name === MAC_ADDRESS_PARAM)?.value || undefined;
}

/**
 * The MAC address of the NAS a scene names. The snapshot in memory answers for any device of a NAS
 * read since the start; a NAS asleep since then is only known through the param Gladys stored on
 * its device. Without a device, the only NAS known to carry one stands in (single-NAS setups).
 */
function wakeTarget(fleet, gladys, externalId) {
  const target = fleet.resolve(gladys, externalId);
  const fromSnapshot = target?.service.snapshot?.nas.macAddress;
  if (fromSnapshot) return fromSnapshot;
  const created = gladys.devices ?? [];
  if (externalId) return macParam(created.find((device) => device.external_id === externalId));
  const known = [...new Set(created.map(macParam).filter(Boolean))];
  return known.length === 1 ? known[0] : undefined;
}

/**
 * Sends a Wake-on-LAN packet to the NAS, through the Gladys core (a broadcast never leaves the
 * integration container). Fire-and-forget by nature: the packet left, the NAS still has to have
 * Wake-on-LAN enabled and to boot. The next refresh shows it back. Never a scene event: an action
 * must not be able to start a scene.
 */
export async function wakeNas(fleet, gladys, fields = {}) {
  const macAddress = wakeTarget(fleet, gladys, fields.device);
  if (!macAddress) {
    throw new Error(
      'The MAC address of this NAS is unknown: select the NAS device itself, created in Gladys after DSM has been reached once with an account allowed to read its network settings.',
    );
  }
  await gladys.wakeOnLan(macAddress);
  return { mac_address: macAddress };
}
