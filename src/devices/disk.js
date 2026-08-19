import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

const DEVICE_TYPE = 'synology-disk';

export const DISK_FEATURE = {
  SMART_STATUS: 'smart-status',
  SMART_HEALTHY: 'smart-healthy',
  TEMPERATURE: 'temperature',
};

function textFeature(ids, name, key) {
  return {
    name,
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
    min: 0,
    max: 0,
    read_only: true,
    has_feedback: false,
    keep_history: false,
  };
}

export function buildDiskDevice(gladys, nasId, disk) {
  const ids = gladys.externalIds(DEVICE_TYPE, `${nasId}:${disk.id}`);
  return {
    name: `Synology ${disk.name}`,
    external_id: ids.device,
    features: [
      textFeature(ids, 'SMART status', DISK_FEATURE.SMART_STATUS),
      {
        name: 'SMART healthy',
        external_id: ids.feature(DISK_FEATURE.SMART_HEALTHY),
        category: DEVICE_FEATURE_CATEGORIES.UNKNOWN,
        type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
        min: 0,
        max: 1,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
      {
        name: 'Temperature',
        external_id: ids.feature(DISK_FEATURE.TEMPERATURE),
        category: DEVICE_FEATURE_CATEGORIES.DEVICE_TEMPERATURE_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
        unit: DEVICE_FEATURE_UNITS.CELSIUS,
        min: -20,
        max: 120,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
    ],
  };
}

export function buildDiskStates(gladys, nasId, disk) {
  const ids = gladys.externalIds(DEVICE_TYPE, `${nasId}:${disk.id}`);
  const states = [];
  if (disk.smartStatus !== undefined && disk.smartStatus !== '') {
    states.push({
      device_feature_external_id: ids.feature(DISK_FEATURE.SMART_STATUS),
      text: disk.smartStatus,
    });
  }
  if (disk.smartHealthy !== undefined) {
    states.push({
      device_feature_external_id: ids.feature(DISK_FEATURE.SMART_HEALTHY),
      state: disk.smartHealthy,
    });
  }
  if (disk.temperature !== undefined) {
    states.push({
      device_feature_external_id: ids.feature(DISK_FEATURE.TEMPERATURE),
      state: disk.temperature,
    });
  }
  return states;
}
