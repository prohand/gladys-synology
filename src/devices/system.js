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
  RECEIVE_RATE: 'network-receive',
  TRANSMIT_RATE: 'network-transmit',
  UPTIME: 'uptime',
  DSM_VERSION: 'dsm-version',
};

export function systemDeviceExternalId(gladys, nasId) {
  return gladys.externalIds(DEVICE_TYPE, nasId).device;
}

export function buildSystemDevice(gladys, nasId, nas, config) {
  const ids = gladys.externalIds(DEVICE_TYPE, nasId);
  return {
    name: nas.model || 'Synology NAS',
    external_id: ids.device,
    // The configuration is user-facing seconds; Gladys' device contract uses milliseconds.
    poll_frequency: config.poll_frequency * 1000,
    features: [
      {
        name: 'CPU usage',
        external_id: ids.feature(SYSTEM_FEATURE.CPU),
        category: DEVICE_FEATURE_CATEGORIES.UNKNOWN,
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
        category: DEVICE_FEATURE_CATEGORIES.UNKNOWN,
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
        name: 'Network received',
        external_id: ids.feature(SYSTEM_FEATURE.RECEIVE_RATE),
        category: DEVICE_FEATURE_CATEGORIES.DATARATE,
        type: DEVICE_FEATURE_TYPES.DATARATE.RATE,
        unit: DEVICE_FEATURE_UNITS.BYTES_PER_SECOND,
        min: 0,
        max: 10 ** 11,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
      {
        name: 'Network transmitted',
        external_id: ids.feature(SYSTEM_FEATURE.TRANSMIT_RATE),
        category: DEVICE_FEATURE_CATEGORIES.DATARATE,
        type: DEVICE_FEATURE_TYPES.DATARATE.RATE,
        unit: DEVICE_FEATURE_UNITS.BYTES_PER_SECOND,
        min: 0,
        max: 10 ** 11,
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
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
    ],
  };
}

export function buildSystemStates(gladys, nasId, nas) {
  const ids = gladys.externalIds(DEVICE_TYPE, nasId);
  const values = [
    [SYSTEM_FEATURE.CPU, nas.cpuUsage],
    [SYSTEM_FEATURE.MEMORY, nas.memoryUsage],
    [SYSTEM_FEATURE.TEMPERATURE, nas.temperature],
    [SYSTEM_FEATURE.RECEIVE_RATE, nas.receiveRate],
    [SYSTEM_FEATURE.TRANSMIT_RATE, nas.transmitRate],
    [SYSTEM_FEATURE.UPTIME, nas.uptime],
    [SYSTEM_FEATURE.DSM_VERSION, nas.dsmVersion || undefined],
  ];
  return values
    .filter(([, state]) => state !== undefined)
    .map(([key, state]) => ({ device_feature_external_id: ids.feature(key), state }));
}
