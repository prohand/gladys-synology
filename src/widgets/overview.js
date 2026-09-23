import { WIDGET_CHART_INTERVALS, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { SYSTEM_FEATURE, systemExternalIds } from '../devices/system.js';
import {
  contentTtl,
  temperature,
  thresholdColor,
  truncate,
  UNREACHABLE_ROW,
  volumeColor,
} from './format.js';

export const DEFAULT_CHART_INTERVAL = WIDGET_CHART_INTERVALS.LAST_DAY;
const MAX_VOLUME_ROWS = 6;

// DSM reports firmware_ver as "DSM 7.2.2-72806": do not prefix it a second time.
function dsmLabel(version) {
  if (!version) return undefined;
  return /^dsm\b/i.test(version) ? version : `DSM ${version}`;
}

function caption(snapshot) {
  const { nas, volumes, disks } = snapshot;
  const parts = [dsmLabel(nas.dsmVersion)];
  return {
    en: [...parts, `${volumes.length} volume(s)`, `${disks.length} disk(s)`]
      .filter(Boolean)
      .join(' · '),
    fr: [...parts, `${volumes.length} volume(s)`, `${disks.length} disque(s)`]
      .filter(Boolean)
      .join(' · '),
  };
}

function tiles(nas, units) {
  const components = [];
  if (nas.cpuUsage !== undefined) {
    components.push({
      type: 'value',
      label: 'CPU',
      value: Math.round(nas.cpuUsage),
      unit: '%',
      icon: 'cpu',
      color: thresholdColor(nas.cpuUsage, 75, 90),
    });
  }
  if (nas.memoryUsage !== undefined) {
    components.push({
      type: 'value',
      label: { en: 'Memory', fr: 'Mémoire' },
      value: Math.round(nas.memoryUsage),
      unit: '%',
      icon: 'layers',
      color: thresholdColor(nas.memoryUsage, 80, 90),
    });
  }
  if (nas.temperature !== undefined) {
    components.push({
      type: 'value',
      label: { en: 'Temperature', fr: 'Température' },
      ...temperature(nas.temperature, units),
      icon: 'thermometer',
      color: thresholdColor(nas.temperature, 55, 65),
    });
  }
  return components;
}

function volumeRow(volume) {
  const usage = volume.usagePercent === undefined ? '?' : `${Math.round(volume.usagePercent)} %`;
  const healthy = volume.healthy === 1;
  return {
    label: truncate(volume.name, 40),
    value: healthy ? usage : truncate(`${usage} · ${volume.status}`, 40),
    icon: 'hard-drive',
    color: volumeColor(volume),
  };
}

function disksRow(disks) {
  const judged = disks.filter((disk) => disk.smartHealthy !== undefined);
  const healthy = judged.filter((disk) => disk.smartHealthy === 1).length;
  let color = WIDGET_COLORS.NEUTRAL;
  if (judged.length > 0) {
    color = healthy === judged.length ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER;
  }
  return {
    label: { en: 'Disks (SMART)', fr: 'Disques (SMART)' },
    value: { en: `${healthy}/${disks.length} healthy`, fr: `${healthy}/${disks.length} sains` },
    icon: 'disc',
    color,
  };
}

function backupsRow(backups) {
  const count = (outcome) => backups.filter((backup) => backup.outcome === outcome).length;
  const failed = count('failure');
  const partial = count('partial');
  const succeeded = count('success');
  let color = WIDGET_COLORS.SUCCESS;
  if (failed > 0) color = WIDGET_COLORS.DANGER;
  else if (partial > 0) color = WIDGET_COLORS.WARNING;
  else if (succeeded === 0) color = WIDGET_COLORS.NEUTRAL;
  const en = [`${succeeded} OK`];
  const fr = [`${succeeded} OK`];
  if (partial > 0) {
    en.push(`${partial} partial`);
    fr.push(`${partial} partielle(s)`);
  }
  if (failed > 0) {
    en.push(`${failed} failed`);
    fr.push(`${failed} en échec`);
  }
  return {
    label: { en: 'Backups', fr: 'Sauvegardes' },
    value: { en: en.join(', '), fr: fr.join(', ') },
    icon: 'archive',
    color,
  };
}

/**
 * "Synology NAS" card: the load tiles, the history of the load when the NAS device exists in
 * Gladys, one row per volume and a summary of the disks and backups.
 */
export function buildOverviewContent({ gladys, service, settings = {}, units, pollFrequency }) {
  const { snapshot } = service;
  const components = [
    { type: 'text', variant: 'heading', text: truncate(snapshot.nas.model, 40) },
    { type: 'text', variant: 'caption', text: caption(snapshot) },
    ...tiles(snapshot.nas, units),
  ];

  // The chart reads the history Gladys keeps, which only exists once the user created the device.
  const ids = systemExternalIds(gladys, service.nasId);
  if ((gladys.devices ?? []).some((device) => device.external_id === ids.device)) {
    components.push({
      type: 'chart',
      chart_type: 'line',
      title: { en: 'Load', fr: 'Charge' },
      unit: '%',
      device_features: [ids.feature(SYSTEM_FEATURE.CPU), ids.feature(SYSTEM_FEATURE.MEMORY)],
      interval: settings.chart_interval || DEFAULT_CHART_INTERVAL,
    });
  }

  const rows = [
    ...(service.lastError ? [UNREACHABLE_ROW] : []),
    ...snapshot.volumes.slice(0, MAX_VOLUME_ROWS).map(volumeRow),
    ...(snapshot.disks.length > 0 ? [disksRow(snapshot.disks)] : []),
    ...(snapshot.backups.length > 0 ? [backupsRow(snapshot.backups)] : []),
  ];
  if (rows.length > 0) components.push({ type: 'status', items: rows });

  if (service.config.url.startsWith('https://')) {
    components.push({
      type: 'button',
      label: { en: 'Open DSM', fr: 'Ouvrir DSM' },
      icon: 'external-link',
      style: 'secondary',
      link: { url: service.config.url },
    });
  }

  return { ttl_seconds: contentTtl(pollFrequency), components };
}
