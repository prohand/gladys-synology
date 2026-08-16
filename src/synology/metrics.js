function finite(...candidates) {
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function bytes(value) {
  const number = finite(value);
  return number === undefined ? undefined : number;
}

function normalizeStatus(value) {
  const status = String(value ?? '').toLowerCase();
  return ['normal', 'healthy', 'mounted', 'ready', 'good'].includes(status) ? 1 : 0;
}

function roundToTwoDecimals(value) {
  return value === undefined ? undefined : Math.round(value * 100) / 100;
}

function arrayFrom(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function scalar(...values) {
  return values.find(
    (value) => ['string', 'number', 'boolean'].includes(typeof value) && String(value) !== '',
  );
}

function isoDate(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10 ** 12 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizeVolumes(storage = {}) {
  const candidates = storage.volumes ?? storage.volume ?? storage.vol_info ?? [];
  return (Array.isArray(candidates) ? candidates : Object.values(candidates)).map(
    (volume, index) => {
      const total = bytes(
        volume.size?.total ?? volume.total_size ?? volume.total ?? volume.size_total,
      );
      const used = bytes(volume.size?.used ?? volume.used_size ?? volume.used ?? volume.size_used);
      const free = bytes(volume.size?.free ?? volume.free_size ?? volume.free ?? volume.size_free);
      const computedUsed =
        used ?? (total !== undefined && free !== undefined ? total - free : undefined);
      const computedFree =
        free ??
        (total !== undefined && computedUsed !== undefined ? total - computedUsed : undefined);
      const usage = finite(
        volume.usage,
        volume.used_percent,
        total && computedUsed !== undefined ? (computedUsed / total) * 100 : undefined,
      );
      return {
        id: String(volume.id ?? volume.volume_id ?? volume.name ?? `volume-${index + 1}`),
        name: String(volume.display_name ?? volume.name ?? volume.id ?? `Volume ${index + 1}`),
        status: String(
          volume.status ?? volume.status_info?.status ?? volume.status_info ?? 'unknown',
        ),
        healthy: normalizeStatus(volume.status ?? volume.status_info?.status ?? volume.status_info),
        totalBytes: total,
        usedBytes: computedUsed,
        freeBytes: computedFree,
        usagePercent: roundToTwoDecimals(usage),
      };
    },
  );
}

function smartHealth(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const status = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (['normal', 'healthy', 'good', 'passed', 'pass', 'ok'].includes(status)) return 1;
  if (
    ['unknown', 'unsupported', 'not_supported', 'not_available', 'unavailable'].includes(status)
  ) {
    return undefined;
  }
  return 0;
}

function normalizeDisks(storage = {}) {
  const candidates = storage.disks ?? storage.disk ?? storage.disk_info ?? [];
  return arrayFrom(candidates).map((disk, index) => {
    const smartStatus = scalar(
      disk.smart_status,
      disk.smartStatus,
      disk.smart?.status,
      disk.smart_status_info?.status,
    );
    return {
      id: String(disk.id ?? disk.disk_id ?? disk.device ?? disk.name ?? `disk-${index + 1}`),
      name: String(
        disk.display_name ?? disk.name ?? disk.model ?? disk.device ?? `Drive ${index + 1}`,
      ),
      smartStatus: smartStatus === undefined ? undefined : String(smartStatus),
      smartHealthy: smartHealth(smartStatus),
    };
  });
}

function normalizeBackupTask(provider, task, index) {
  const versions = arrayFrom(task.versions ?? task.version_list);
  const latestVersion = versions[0] ?? {};
  const lastResult =
    task.last_result && typeof task.last_result === 'object' ? task.last_result : {};
  const id = scalar(task.task_id, task.id, task.taskId, task.name, index + 1);
  const name = scalar(task.task_name, task.name, task.title, `${provider} ${index + 1}`);
  const status = scalar(task.status, task.state, task.task_status, latestVersion.status);
  const rawResult = scalar(
    task.last_bkp_result,
    lastResult.status,
    task.last_result,
    task.last_status,
    task.result,
    latestVersion.result,
    latestVersion.status,
  );
  let result = rawResult;
  if (provider === 'active-backup' && lastResult.status !== undefined) {
    result =
      { 2: 'success', 3: 'partial success', 4: 'failed', 5: 'cancelled' }[
        Number(lastResult.status)
      ] ?? rawResult;
  } else if (provider === 'active-backup' && Number(latestVersion.status) === 3) {
    result = 'success';
  }
  const lastBackupAt = isoDate(
    scalar(
      task.last_bkp_time,
      task.last_backup_time,
      task.last_finish_time,
      task.end_time,
      lastResult.time_end,
      lastResult.time_start,
      latestVersion.backup_time,
      latestVersion.version_time,
      latestVersion.end_time,
      latestVersion.time_end,
      latestVersion.time_start,
      latestVersion.create_time,
    ),
  );
  return {
    id: String(id),
    provider,
    name: String(name),
    status: status === undefined ? undefined : String(status),
    result: result === undefined ? undefined : String(result),
    lastBackupAt,
  };
}

function normalizeBackupTasks(provider, data) {
  if (!data) return [];
  const tasks = arrayFrom(data.task_list ?? data.tasks ?? data.items);
  return tasks.map((task, index) => normalizeBackupTask(provider, task, index));
}

export function normalizeSnapshot(snapshot) {
  const system = snapshot.system ?? {};
  const utilization = snapshot.utilization ?? {};
  const cpu = utilization.cpu ?? {};
  const memory = utilization.memory ?? {};

  const userLoad = finite(cpu.user_load, cpu.user);
  const systemLoad = finite(cpu.system_load, cpu.system);
  const otherLoad = finite(cpu.other_load, cpu.other);
  const calculatedCpu = [userLoad, systemLoad, otherLoad].filter(Number.isFinite);
  const cpuUsage = finite(
    cpu.total_load,
    cpu.load,
    calculatedCpu.length ? calculatedCpu.reduce((sum, value) => sum + value, 0) : undefined,
  );
  return {
    nas: {
      serial: String(system.serial ?? system.serial_number ?? ''),
      model: String(system.model ?? system.model_name ?? 'Synology NAS'),
      dsmVersion: String(system.firmware_ver ?? system.version ?? ''),
      temperature: finite(system.temperature, system.sys_temp, system.system_temperature),
      cpuUsage,
      memoryUsage: finite(memory.real_usage, memory.usage),
    },
    volumes: normalizeVolumes(snapshot.storage ?? {}),
    disks: normalizeDisks(snapshot.storage ?? {}),
    backups: [
      ...normalizeBackupTasks('hyper-backup', snapshot.hyperBackup),
      ...normalizeBackupTasks('active-backup', snapshot.activeBackup),
    ],
  };
}

export function bytesToGigabytes(value) {
  return value === undefined ? undefined : Math.round((value / 1024 ** 3) * 100) / 100;
}
