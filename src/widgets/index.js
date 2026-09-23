import { buildBackupsContent } from './backups.js';
import { messageContent, UNREACHABLE_ROW } from './format.js';
import { buildOverviewContent } from './overview.js';
import { buildStorageContent } from './storage.js';

/** Keys of the manifest `widgets`. A published key is never renamed. */
export const WIDGET = {
  OVERVIEW: 'nas_overview',
  STORAGE: 'storage',
  BACKUPS: 'backups',
};

const NOT_CONNECTED = {
  en: 'Synology DSM is not connected yet. Check the integration configuration.',
  fr: "Synology DSM n'est pas encore connecté. Vérifiez la configuration de l'intégration.",
};
const UNKNOWN_DEVICE = {
  en: 'The chosen device is no longer known. Choose a Synology device in the widget settings.',
  fr: "L'appareil choisi n'est plus connu. Choisissez un appareil Synology dans les réglages du widget.",
};
const FIRST_READING = {
  en: 'Waiting for the first reading of the NAS.',
  fr: 'En attente du premier relevé du NAS.',
};

const SINGLE_NAS_BUILDERS = {
  [WIDGET.OVERVIEW]: buildOverviewContent,
  [WIDGET.STORAGE]: buildStorageContent,
};

/**
 * Content of one dashboard widget, built from the snapshots already in memory: a widget never
 * queries DSM itself, so opening a dashboard cannot hammer the NAS nor exceed the 15 s answer
 * delay. `fleet` is null while the integration is not configured.
 */
export function buildWidgetContent(key, { gladys, fleet, settings = {}, units, pollFrequency }) {
  if (!fleet) return messageContent(NOT_CONNECTED, pollFrequency);
  const target = fleet.resolve(gladys, settings.nas);

  if (key === WIDGET.BACKUPS) {
    if (settings.nas && !target) return messageContent(UNKNOWN_DEVICE, pollFrequency);
    const services = settings.nas ? [target.service] : fleet.services;
    return buildBackupsContent({ services, settings, pollFrequency });
  }

  const build = SINGLE_NAS_BUILDERS[key];
  if (!build) throw new Error(`Unknown Synology widget: ${key}`);
  if (!target) {
    return messageContent(settings.nas ? UNKNOWN_DEVICE : NOT_CONNECTED, pollFrequency);
  }
  if (!target.service.snapshot) {
    const extra = target.service.lastError ? [{ type: 'status', items: [UNREACHABLE_ROW] }] : [];
    return messageContent(FIRST_READING, pollFrequency, extra);
  }
  return build({ gladys, service: target.service, settings, units, pollFrequency });
}
