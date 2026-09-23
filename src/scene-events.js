import { backupExternalIds, backupProviderName } from './devices/backup.js';
import { diskExternalIds } from './devices/disk.js';
import { systemExternalIds } from './devices/system.js';
import { volumeExternalIds } from './devices/volume.js';
import { formatDate } from './date-format.js';

/** Keys of the manifest `scene_triggers`. A published key is never renamed. */
export const SCENE_TRIGGER = {
  NAS_UNREACHABLE: 'nas_unreachable',
  NAS_REACHABLE: 'nas_reachable',
  VOLUME_UNHEALTHY: 'volume_unhealthy',
  DISK_UNHEALTHY: 'disk_unhealthy',
  BACKUP_FINISHED: 'backup_finished',
  DSM_UPDATED: 'dsm_updated',
};

function nasName(snapshot, nasId) {
  return snapshot?.nas.model || nasId;
}

/**
 * Turns the successive readings of ONE NAS into scene events: something that HAPPENED between two
 * refreshes (a volume that degraded, a backup that finished, the NAS that stopped answering).
 *
 * The first reading after startup is only a reference: comparing it with nothing would announce
 * every existing failure again on each restart of the integration. Health follows the same rule as
 * the published states — only a clear healthy → unhealthy transition counts, a maintenance state in
 * between keeps the last known verdict.
 */
export class SceneEventTracker {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.reachable = undefined;
    this.unreachableSince = null;
    this.dsmVersion = undefined;
    this.volumeHealth = new Map();
    this.diskHealth = new Map();
    this.backupRuns = new Map();
  }

  /** A refresh succeeded: returns the `{ key, data }` events it reveals. */
  observe(gladys, { nasId, url, dateFormat }, snapshot) {
    const events = [];
    const nas = systemExternalIds(gladys, nasId).device;
    const name = nasName(snapshot, nasId);

    if (this.reachable === false && this.unreachableSince !== null) {
      events.push({
        key: SCENE_TRIGGER.NAS_REACHABLE,
        data: {
          device: nas,
          nas_name: name,
          url,
          offline_minutes: Math.round((this.now() - this.unreachableSince) / 60_000),
        },
      });
    }
    this.reachable = true;
    this.unreachableSince = null;

    const version = snapshot.nas.dsmVersion || undefined;
    if (this.dsmVersion && version && version !== this.dsmVersion) {
      events.push({
        key: SCENE_TRIGGER.DSM_UPDATED,
        data: { device: nas, nas_name: name, previous_version: this.dsmVersion, version },
      });
    }
    if (version) this.dsmVersion = version;

    for (const volume of snapshot.volumes ?? []) {
      if (this.degraded(this.volumeHealth, volume.id, volume.healthy)) {
        events.push({
          key: SCENE_TRIGGER.VOLUME_UNHEALTHY,
          data: {
            device: volumeExternalIds(gladys, nasId, volume.id).device,
            nas_name: name,
            volume_name: volume.name,
            status: volume.status,
            usage_percent: volume.usagePercent ?? null,
          },
        });
      }
    }

    for (const disk of snapshot.disks ?? []) {
      if (this.degraded(this.diskHealth, disk.id, disk.smartHealthy)) {
        events.push({
          key: SCENE_TRIGGER.DISK_UNHEALTHY,
          data: {
            device: diskExternalIds(gladys, nasId, disk.id).device,
            nas_name: name,
            disk_name: disk.name,
            smart_status: disk.smartStatus ?? null,
            temperature: disk.temperature ?? null,
          },
        });
      }
    }

    for (const backup of snapshot.backups ?? []) {
      if (this.finished(backup)) {
        events.push({
          key: SCENE_TRIGGER.BACKUP_FINISHED,
          data: {
            device: backupExternalIds(gladys, nasId, backup).device,
            provider: backup.provider,
            outcome: backup.outcome,
            nas_name: name,
            task_name: backup.name,
            provider_name: backupProviderName(backup.provider),
            result: backup.result,
            last_backup: formatDate(backup.lastBackupAt, dateFormat) ?? null,
          },
        });
      }
    }

    return events;
  }

  /** A refresh failed: returns the event of a NAS that was answering and no longer does. */
  observeFailure(gladys, { nasId, url }, snapshot, error) {
    const wasReachable = this.reachable === true;
    this.reachable = false;
    if (!wasReachable) return [];
    this.unreachableSince = this.now();
    return [
      {
        key: SCENE_TRIGGER.NAS_UNREACHABLE,
        data: {
          device: systemExternalIds(gladys, nasId).device,
          nas_name: nasName(snapshot, nasId),
          url,
          error: String(error?.message ?? error).slice(0, 1000),
        },
      },
    ];
  }

  // Remembers the last clear verdict (1 or 0) and reports a 1 → 0 transition only.
  degraded(verdicts, id, healthy) {
    if (healthy === undefined) return false;
    const previous = verdicts.get(id);
    verdicts.set(id, healthy);
    return previous === 1 && healthy === 0;
  }

  // A backup run is identified by its date and result. A reading without an outcome (still
  // running, never ran) does not replace the last finished run, so the run that follows is compared
  // with it; a task first seen without an outcome is remembered as `null`, so its first finished
  // run fires even when it was already running at startup.
  finished(backup) {
    const key = `${backup.provider}:${backup.id}`;
    const previous = this.backupRuns.get(key);
    if (!backup.outcome) {
      if (previous === undefined) this.backupRuns.set(key, null);
      return false;
    }
    const run = `${backup.lastBackupAt ?? ''}|${backup.result}`;
    this.backupRuns.set(key, run);
    return previous !== undefined && previous !== run;
  }
}
