import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

const DEVICE_TYPE = 'synology-backup';

export const BACKUP_FEATURE = {
  STATUS: 'status',
  RESULT: 'last-result',
  LAST_BACKUP: 'last-backup',
};

function backupPlatformId(nasId, backup) {
  return `${nasId}:${backup.provider}:${backup.id}`;
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
  const ids = gladys.externalIds(DEVICE_TYPE, backupPlatformId(nasId, backup));
  const providerName = backup.provider === 'hyper-backup' ? 'Hyper Backup' : 'Active Backup';
  return {
    name: `${nas.model || nasId} - ${providerName} - ${backup.name}`,
    external_id: ids.device,
    features: [
      textFeature(ids, 'Status', BACKUP_FEATURE.STATUS),
      textFeature(ids, 'Last result', BACKUP_FEATURE.RESULT),
      textFeature(ids, 'Last backup', BACKUP_FEATURE.LAST_BACKUP),
    ],
  };
}

export function buildBackupStates(gladys, nasId, backup) {
  const ids = gladys.externalIds(DEVICE_TYPE, backupPlatformId(nasId, backup));
  const values = [
    [BACKUP_FEATURE.STATUS, backup.status],
    [BACKUP_FEATURE.RESULT, backup.result],
    [BACKUP_FEATURE.LAST_BACKUP, backup.lastBackupAt],
  ];
  return values
    .filter(([, text]) => text !== undefined && text !== '')
    .map(([key, text]) => ({ device_feature_external_id: ids.feature(key), text }));
}
