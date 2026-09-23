import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import {
  contentTtl,
  formatSize,
  temperature,
  truncate,
  UNREACHABLE_ROW,
  volumeColor,
} from './format.js';

const MAX_GAUGES = 6;
const MAX_DISK_ROWS = 10;
const DISK_WARNING_TEMPERATURE = 55;

function freeSpaceCaption(volumes) {
  const sized = volumes.filter(
    (volume) => volume.totalBytes !== undefined && volume.freeBytes !== undefined,
  );
  if (sized.length === 0) return undefined;
  const free = formatSize(sized.reduce((sum, volume) => sum + volume.freeBytes, 0));
  const total = formatSize(sized.reduce((sum, volume) => sum + volume.totalBytes, 0));
  return {
    type: 'text',
    variant: 'caption',
    text: { en: `${free.en} free of ${total.en}`, fr: `${free.fr} libres sur ${total.fr}` },
  };
}

function diskRow(disk, units) {
  const parts = [disk.smartStatus ?? '?'];
  if (disk.temperature !== undefined) {
    const { value, unit } = temperature(disk.temperature, units);
    parts.push(`${value} ${unit}`);
  }
  let color = WIDGET_COLORS.NEUTRAL;
  if (disk.smartHealthy === 0) color = WIDGET_COLORS.DANGER;
  else if (disk.temperature >= DISK_WARNING_TEMPERATURE) color = WIDGET_COLORS.WARNING;
  else if (disk.smartHealthy === 1) color = WIDGET_COLORS.SUCCESS;
  return {
    label: truncate(disk.name, 40),
    value: truncate(parts.join(' · '), 40),
    icon: 'disc',
    color,
  };
}

/** "Synology storage" card: one gauge per volume, the free space and one row per disk. */
export function buildStorageContent({ service, units, pollFrequency }) {
  const { snapshot } = service;
  const components = [
    {
      type: 'text',
      variant: 'heading',
      text: {
        en: truncate(`${snapshot.nas.model} storage`, 40),
        fr: truncate(`Stockage ${snapshot.nas.model}`, 40),
      },
    },
  ];
  const caption = freeSpaceCaption(snapshot.volumes);
  if (caption) components.push(caption);

  for (const volume of snapshot.volumes
    .filter((entry) => entry.usagePercent !== undefined)
    .slice(0, MAX_GAUGES)) {
    components.push({
      type: 'gauge',
      label: truncate(volume.name, 24),
      value: volume.usagePercent,
      min: 0,
      max: 100,
      unit: '%',
      color: volumeColor(volume),
    });
  }

  const rows = [
    ...(service.lastError ? [UNREACHABLE_ROW] : []),
    ...snapshot.disks.map((disk) => diskRow(disk, units)),
  ].slice(0, MAX_DISK_ROWS);
  if (rows.length > 0) components.push({ type: 'status', items: rows });

  if (snapshot.volumes.length === 0 && snapshot.disks.length === 0) {
    components.push({
      type: 'text',
      variant: 'body',
      text: {
        en: 'DSM reports no volume and no disk for this NAS.',
        fr: 'DSM ne signale aucun volume ni disque pour ce NAS.',
      },
    });
  }

  return { ttl_seconds: contentTtl(pollFrequency), components };
}
