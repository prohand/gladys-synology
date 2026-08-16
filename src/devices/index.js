import { buildSystemDevice, buildSystemStates } from './system.js';
import { buildVolumeDevice, buildVolumeStates } from './volume.js';

export function buildDiscoveredDevices(gladys, nasId, snapshot) {
  return [
    buildSystemDevice(gladys, nasId, snapshot.nas),
    ...snapshot.volumes.map((volume) => buildVolumeDevice(gladys, nasId, volume)),
  ];
}

export function buildStates(gladys, nasId, snapshot) {
  return [
    ...buildSystemStates(gladys, nasId, snapshot.nas),
    ...snapshot.volumes.flatMap((volume) => buildVolumeStates(gladys, nasId, volume)),
  ];
}
