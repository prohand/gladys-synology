import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { formatDate } from '../date-format.js';

const DEVICE_TYPE = 'synology-backup';

export const BACKUP_FEATURE = {
  STATUS: 'status',
  RESULT: 'last-result',
  LAST_BACKUP: 'last-backup',
  VERSION_COUNT: 'version-count',
};

// Hyper Backup keeps at most 65535 versions per task.
const MAX_VERSION_COUNT = 65535;

function backupPlatformId(nasId, backup) {
  return `${nasId}:${backup.provider}:${backup.id}`;
}

export function backupExternalIds(gladys, nasId, backup) {
  return gladys.externalIds(DEVICE_TYPE, backupPlatformId(nasId, backup));
}

export function backupProviderName(provider) {
  return provider === 'hyper-backup' ? 'Hyper Backup' : 'Active Backup';
}

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

export function buildBackupDevice(gladys, nasId, nas, backup) {
  const ids = backupExternalIds(gladys, nasId, backup);
  return {
    name: `${nas.model || nasId} - ${backupProviderName(backup.provider)} - ${backup.name}`,
    external_id: ids.device,
    features: [
      textFeature(ids, 'Status', BACKUP_FEATURE.STATUS),
      textFeature(ids, 'Last result', BACKUP_FEATURE.RESULT),
      textFeature(ids, 'Last backup', BACKUP_FEATURE.LAST_BACKUP),
      // Only when DSM gave a count: a DSM without SYNO.Backup.Version gets no dead feature.
      ...(backup.versionCount === undefined
        ? []
        : [
            {
              name: 'Versions',
              external_id: ids.feature(BACKUP_FEATURE.VERSION_COUNT),
              // `unknown` has no `integer` label in the Gladys UI (an empty chip): `counter-sensor`
              // + `integer` is shown as an integer counter.
              category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
              type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
              min: 0,
              max: MAX_VERSION_COUNT,
              read_only: true,
              has_feedback: false,
              keep_history: false,
            },
          ]),
    ],
  };
}

export function buildBackupStates(gladys, nasId, backup, { dateFormat } = {}) {
  const ids = backupExternalIds(gladys, nasId, backup);
  const values = [
    [BACKUP_FEATURE.STATUS, backup.status],
    [BACKUP_FEATURE.RESULT, backup.result],
    [BACKUP_FEATURE.LAST_BACKUP, formatDate(backup.lastBackupAt, dateFormat)],
  ];
  const states = values
    .filter(([, text]) => text !== undefined && text !== '')
    .map(([key, text]) => ({ device_feature_external_id: ids.feature(key), text }));
  if (backup.versionCount !== undefined) {
    states.push({
      device_feature_external_id: ids.feature(BACKUP_FEATURE.VERSION_COUNT),
      state: backup.versionCount,
    });
  }
  return states;
}
