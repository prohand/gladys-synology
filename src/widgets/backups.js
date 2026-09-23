import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { backupProviderName } from '../devices/backup.js';
import { contentTtl, truncate } from './format.js';

const MAX_ITEMS = 8;
export const BACKUP_FILTER = { ALL: 'all', PROBLEMS: 'problems' };

const OUTCOMES = {
  failure: { rank: 0, text: { en: 'Failed', fr: 'Échec' }, color: WIDGET_COLORS.DANGER },
  partial: { rank: 1, text: { en: 'Partial', fr: 'Partielle' }, color: WIDGET_COLORS.WARNING },
  success: { rank: 3, text: { en: 'Success', fr: 'Réussie' }, color: WIDGET_COLORS.SUCCESS },
};
const UNKNOWN_RANK = 2;

function badge(backup) {
  const outcome = OUTCOMES[backup.outcome];
  if (outcome) return { text: outcome.text, color: outcome.color };
  const raw = backup.status ?? backup.result;
  return raw ? { text: truncate(raw, 16), color: WIDGET_COLORS.INFO } : undefined;
}

// Failures first, so they stay visible when the list is capped; then the most recent runs.
function compare(left, right) {
  const rank = (entry) => OUTCOMES[entry.backup.outcome]?.rank ?? UNKNOWN_RANK;
  return (
    rank(left) - rank(right) ||
    String(right.backup.lastBackupAt ?? '').localeCompare(String(left.backup.lastBackupAt ?? '')) ||
    left.backup.name.localeCompare(right.backup.name)
  );
}

function item({ backup, model }) {
  const entry = {
    title: truncate(backup.name, 60),
    subtitle: truncate(`${backupProviderName(backup.provider)} · ${model}`, 60),
  };
  if (backup.lastBackupAt && !Number.isNaN(new Date(backup.lastBackupAt).getTime())) {
    entry.date = backup.lastBackupAt;
  }
  const label = badge(backup);
  if (label) entry.badge = label;
  return entry;
}

/**
 * "Synology backups" card: the Hyper Backup and Active Backup tasks of one NAS, or of every NAS,
 * with their last result. `services` are the NAS to show.
 */
export function buildBackupsContent({ services, settings = {}, pollFrequency }) {
  const entries = services
    .filter((service) => service.snapshot)
    .flatMap((service) =>
      service.snapshot.backups.map((backup) => ({ backup, model: service.snapshot.nas.model })),
    );
  const count = (outcome) => entries.filter(({ backup }) => backup.outcome === outcome).length;
  const shown =
    settings.tasks === BACKUP_FILTER.PROBLEMS
      ? entries.filter(({ backup }) => backup.outcome === 'failure' || backup.outcome === 'partial')
      : entries;

  const components = [
    {
      type: 'value',
      label: { en: 'Succeeded', fr: 'Réussies' },
      value: count('success'),
      icon: 'check-circle',
      color: WIDGET_COLORS.SUCCESS,
    },
    {
      type: 'value',
      label: { en: 'To check', fr: 'À vérifier' },
      value: count('failure') + count('partial'),
      icon: 'alert-triangle',
      color: count('failure') > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    },
  ];

  if (shown.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: [...shown].sort(compare).slice(0, MAX_ITEMS).map(item),
    });
  } else {
    components.push({
      type: 'text',
      variant: 'body',
      text:
        entries.length > 0
          ? { en: 'No failed backup.', fr: 'Aucune sauvegarde en échec.' }
          : {
              en: 'No Hyper Backup or Active Backup task found.',
              fr: 'Aucune tâche Hyper Backup ou Active Backup trouvée.',
            },
    });
  }
  if (shown.length > MAX_ITEMS) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: {
        en: `${MAX_ITEMS} of ${shown.length} tasks shown, failures first`,
        fr: `${MAX_ITEMS} tâches sur ${shown.length} affichées, échecs en premier`,
      },
    });
  }

  const unreachable = services.filter((service) => service.lastError);
  if (unreachable.length > 0) {
    components.push({
      type: 'status',
      items: unreachable.slice(0, 10).map((service) => ({
        label: truncate(service.snapshot?.nas.model ?? new URL(service.config.url).host, 40),
        value: { en: 'Unreachable', fr: 'Injoignable' },
        icon: 'wifi-off',
        color: WIDGET_COLORS.DANGER,
      })),
    });
  }

  return { ttl_seconds: contentTtl(pollFrequency), components };
}
