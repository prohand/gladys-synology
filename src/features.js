const slug = (value) => String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const numeric = (id, name, category, type, unit, value) => ({ id, name, category, type, unit, value, min: 0, max: 100, readOnly: true });
const statusValue = (value) => {
  const normalized = String(value).toLowerCase();
  if (['normal', 'healthy', 'success', 'successful', 'finished', 'ok'].includes(normalized)) return 1;
  if (['running', 'backing_up', 'waiting', 'pending'].includes(normalized)) return 0.5;
  if (['unknown', 'undefined', 'null', ''].includes(normalized)) return -1;
  return 0;
};
const status = (id, name, value) => ({ id, name, category: 'synology', type: 'status', value: statusValue(value), min: -1, max: 1, readOnly: true });
const timestamp = (value) => {
  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) return numericValue;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined;
};

export function metricsToDevices(metrics) {
  const root = slug(metrics.hostname) || 'nas';
  const devices = [{
    id: `synology:${root}:system`, name: `${metrics.hostname} — Système`, model: metrics.model,
    features: [
      numeric('cpu', 'Charge CPU', 'system', 'cpu', '%', metrics.cpuPercent),
      numeric('ram', 'Utilisation RAM', 'system', 'memory', '%', metrics.memoryPercent),
      { ...numeric('temperature', 'Température système', 'temperature-sensor', 'temperature', '°C', metrics.temperature), max: 120 },
    ].filter((feature) => feature.value !== undefined),
  }];
  for (const disk of metrics.disks) devices.push({
    id: `synology:${root}:disk:${slug(disk.id)}`, name: `${metrics.hostname} — ${disk.name}`, model: disk.model,
    features: [status('smart', `État SMART (${disk.smartStatus})`, disk.smartStatus),
      { ...numeric('temperature', 'Température', 'temperature-sensor', 'temperature', '°C', disk.temperature), max: 120 },
    ].filter((feature) => feature.value !== undefined),
  });
  for (const volume of metrics.volumes) devices.push({
    id: `synology:${root}:volume:${slug(volume.id)}`, name: `${metrics.hostname} — ${volume.name}`,
    features: [status('status', `État (${volume.status})`, volume.status),
      numeric('used-percent', 'Espace utilisé', 'system', 'disk', '%', volume.usedPercent),
      { ...numeric('free-bytes', 'Espace disponible', 'synology', 'storage', 'B', volume.freeBytes), max: Number.MAX_SAFE_INTEGER },
    ].filter((feature) => feature.value !== undefined),
  });
  for (const backup of metrics.backups) devices.push({
    id: `synology:${root}:backup:${slug(backup.id)}`, name: `${metrics.hostname} — ${backup.name}`,
    features: [status('status', `État Hyper Backup (${backup.status})`, backup.status), ...(timestamp(backup.lastRun) !== undefined ? [{ ...numeric('last-run', 'Dernière exécution', 'synology', 'timestamp', 's', timestamp(backup.lastRun)), max: Number.MAX_SAFE_INTEGER }] : [])],
  });
  return devices;
}
