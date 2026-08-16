import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

const DEVICE_TYPE = 'synology-nas';

export const SYSTEM_FEATURE = {
  CPU: 'cpu-usage',
  MEMORY: 'memory-usage',
  TEMPERATURE: 'temperature',
  UPTIME: 'uptime',
  DSM_VERSION: 'dsm-version',
};

export function systemDeviceExternalId(gladys, nasId) {
  return gladys.externalIds(DEVICE_TYPE, nasId).device;
}

export function buildSystemDevice(gladys, nasId, nas) {
  const ids = gladys.externalIds(DEVICE_TYPE, nasId);
  return {
    name: nas.model || 'Synology NAS',
    external_id: ids.device,
    features: [
      {
        name: 'CPU usage',
        external_id: ids.feature(SYSTEM_FEATURE.CPU),
        category: DEVICE_FEATURE_CATEGORIES.LEVEL_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
        unit: DEVICE_FEATURE_UNITS.PERCENT,
        min: 0,
        max: 100,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
      {
        name: 'Memory usage',
        external_id: ids.feature(SYSTEM_FEATURE.MEMORY),
        category: DEVICE_FEATURE_CATEGORIES.LEVEL_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
        unit: DEVICE_FEATURE_UNITS.PERCENT,
        min: 0,
        max: 100,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
      {
        name: 'System temperature',
        external_id: ids.feature(SYSTEM_FEATURE.TEMPERATURE),
        category: DEVICE_FEATURE_CATEGORIES.DEVICE_TEMPERATURE_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
        unit: DEVICE_FEATURE_UNITS.CELSIUS,
        min: -20,
        max: 120,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
      {
        name: 'Uptime',
        external_id: ids.feature(SYSTEM_FEATURE.UPTIME),
        category: DEVICE_FEATURE_CATEGORIES.DURATION,
        type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
        unit: DEVICE_FEATURE_UNITS.SECONDS,
        min: 0,
        max: 10 ** 10,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
      {
        name: 'DSM version',
        external_id: ids.feature(SYSTEM_FEATURE.DSM_VERSION),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        min: 0,
        max: 0,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
    ],
  };
}

export function buildSystemStates(gladys, nasId, nas) {
  const ids = gladys.externalIds(DEVICE_TYPE, nasId);
  const numericValues = [
    [SYSTEM_FEATURE.CPU, nas.cpuUsage],
    [SYSTEM_FEATURE.MEMORY, nas.memoryUsage],
    [SYSTEM_FEATURE.TEMPERATURE, nas.temperature],
    [SYSTEM_FEATURE.UPTIME, nas.uptime],
  ];
  const states = numericValues
    .filter(([, state]) => state !== undefined)
    .map(([key, state]) => ({ device_feature_external_id: ids.feature(key), state }));

  if (nas.dsmVersion) {
    states.push({
      device_feature_external_id: ids.feature(SYSTEM_FEATURE.DSM_VERSION),
      text: nas.dsmVersion,
    });
  }

  return states;
}
