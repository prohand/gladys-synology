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
        usagePercent: usage,
      };
    },
  );
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
      uptime: finite(system.up_time, system.uptime, utilization.time),
      cpuUsage,
      memoryUsage: finite(memory.real_usage, memory.usage),
    },
    volumes: normalizeVolumes(snapshot.storage ?? {}),
  };
}

export function bytesToGigabytes(value) {
  return value === undefined ? undefined : Math.round((value / 1024 ** 3) * 100) / 100;
}
