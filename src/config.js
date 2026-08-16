const required = ['SYNOLOGY_URL', 'SYNOLOGY_USERNAME', 'SYNOLOGY_PASSWORD', 'GLADYS_URL', 'GLADYS_TOKEN'];

export function loadConfig(env = process.env) {
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Variables requises manquantes : ${missing.join(', ')}`);

  const interval = Number(env.POLL_INTERVAL ?? 60);
  if (!Number.isFinite(interval) || interval < 15) throw new Error('POLL_INTERVAL doit être supérieur ou égal à 15 secondes');

  return {
    synology: {
      baseUrl: env.SYNOLOGY_URL.replace(/\/$/, ''),
      username: env.SYNOLOGY_USERNAME,
      password: env.SYNOLOGY_PASSWORD,
    },
    gladys: { baseUrl: env.GLADYS_URL.replace(/\/$/, ''), token: env.GLADYS_TOKEN },
    pollIntervalMs: interval * 1000,
    enableHyperBackup: env.ENABLE_HYPER_BACKUP === 'true',
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
