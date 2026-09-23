import { backupExternalIds, buildBackupDevice, buildBackupStates } from './backup.js';
import { buildDiskDevice, buildDiskStates, diskExternalIds } from './disk.js';
import { buildSystemDevice, buildSystemStates, systemExternalIds } from './system.js';
import { buildVolumeDevice, buildVolumeStates, volumeExternalIds } from './volume.js';

export function buildDiscoveredDevices(gladys, nasId, snapshot) {
  return [
    buildSystemDevice(gladys, nasId, snapshot.nas),
    ...snapshot.volumes.map((volume) => buildVolumeDevice(gladys, nasId, volume)),
    ...(snapshot.disks ?? []).map((disk) => buildDiskDevice(gladys, nasId, disk)),
    ...(snapshot.backups ?? []).map((backup) =>
      buildBackupDevice(gladys, nasId, snapshot.nas, backup),
    ),
  ];
}

export function buildStates(gladys, nasId, snapshot, options = {}) {
  return [
    ...buildSystemStates(gladys, nasId, snapshot.nas),
    ...snapshot.volumes.flatMap((volume) => buildVolumeStates(gladys, nasId, volume)),
    ...(snapshot.disks ?? []).flatMap((disk) => buildDiskStates(gladys, nasId, disk)),
    ...(snapshot.backups ?? []).flatMap((backup) =>
      buildBackupStates(gladys, nasId, backup, options),
    ),
  ];
}

/**
 * Resolves a device external_id chosen in Gladys (a `source: "devices"` select of a widget or a
 * scene card) back to the snapshot entry it was built from, or `null` when it is not one of this
 * NAS's devices. Rebuilding the ids instead of parsing them keeps the external-ID contract in one
 * place.
 */
export function findDevice(gladys, nasId, snapshot, externalId) {
  if (!snapshot || !externalId) return null;
  if (systemExternalIds(gladys, nasId).device === externalId) {
    return { kind: 'nas', item: snapshot.nas };
  }
  const candidates = [
    ['volume', snapshot.volumes ?? [], (volume) => volumeExternalIds(gladys, nasId, volume.id)],
    ['disk', snapshot.disks ?? [], (disk) => diskExternalIds(gladys, nasId, disk.id)],
    ['backup', snapshot.backups ?? [], (backup) => backupExternalIds(gladys, nasId, backup)],
  ];
  for (const [kind, items, idsOf] of candidates) {
    const item = items.find((entry) => idsOf(entry).device === externalId);
    if (item) return { kind, item };
  }
  return null;
}
