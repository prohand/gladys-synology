import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { bytesToGigabytes } from '../synology/metrics.js';

const DEVICE_TYPE = 'synology-volume';

export const VOLUME_FEATURE = {
  USAGE: 'usage',
  USED: 'used',
  FREE: 'free',
  TOTAL: 'total',
  HEALTHY: 'healthy',
};

function volumePlatformId(nasId, volumeId) {
  return `${nasId}:${volumeId}`;
}

export function buildVolumeDevice(gladys, nasId, volume) {
  const ids = gladys.externalIds(DEVICE_TYPE, volumePlatformId(nasId, volume.id));
  const sizeFeature = (name, key) => ({
    name,
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.DATA,
    type: DEVICE_FEATURE_TYPES.DATA.SIZE,
    unit: DEVICE_FEATURE_UNITS.GIGABYTE,
    min: 0,
    max: 10 ** 9,
    read_only: true,
    has_feedback: false,
    keep_history: key === VOLUME_FEATURE.USED,
  });
  return {
    name: `Synology ${volume.name}`,
    external_id: ids.device,
    features: [
      {
        name: 'Usage',
        external_id: ids.feature(VOLUME_FEATURE.USAGE),
        category: DEVICE_FEATURE_CATEGORIES.UNKNOWN,
        type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
        unit: DEVICE_FEATURE_UNITS.PERCENT,
        min: 0,
        max: 100,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
      sizeFeature('Used space', VOLUME_FEATURE.USED),
      sizeFeature('Free space', VOLUME_FEATURE.FREE),
      sizeFeature('Total space', VOLUME_FEATURE.TOTAL),
      {
        name: 'Healthy',
        external_id: ids.feature(VOLUME_FEATURE.HEALTHY),
        category: DEVICE_FEATURE_CATEGORIES.UNKNOWN,
        type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
        min: 0,
        max: 1,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
    ],
  };
}

export function buildVolumeStates(gladys, nasId, volume) {
  const ids = gladys.externalIds(DEVICE_TYPE, volumePlatformId(nasId, volume.id));
  const values = [
    [VOLUME_FEATURE.USAGE, volume.usagePercent],
    [VOLUME_FEATURE.USED, bytesToGigabytes(volume.usedBytes)],
    [VOLUME_FEATURE.FREE, bytesToGigabytes(volume.freeBytes)],
    [VOLUME_FEATURE.TOTAL, bytesToGigabytes(volume.totalBytes)],
    [VOLUME_FEATURE.HEALTHY, volume.healthy],
  ];
  return values
    .filter(([, state]) => state !== undefined)
    .map(([key, state]) => ({ device_feature_external_id: ids.feature(key), state }));
}
