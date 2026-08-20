import { buildBackupDevice, buildBackupStates } from './backup.js';
import { buildDiskDevice, buildDiskStates } from './disk.js';
import { buildSystemDevice, buildSystemStates } from './system.js';
import { buildVolumeDevice, buildVolumeStates } from './volume.js';

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
