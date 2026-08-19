import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createBackoff } from './src/backoff.js';
import { normalizeConfig } from './src/config.js';
import { SynologyFleetService } from './src/fleet-service.js';

const gladys = new GladysIntegration();
const retryBackoff = createBackoff();
let config = normalizeConfig();
let service = null;
let initialization = Promise.resolve();
let refreshTimer = null;
let retryTimer = null;
let lastRawConfig = null;

function clearRefreshTimer() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

function clearRetryTimer() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function unavailableMessage(error) {
  return {
    en: `Unable to monitor Synology DSM: ${error.message}`,
    fr: `Impossible de superviser Synology DSM : ${error.message}`,
  };
}

// A NAS reboot, a DSM update or a temporary network outage makes the first connection fail.
// Retrying on our own keeps the integration self-healing instead of waiting for a manual restart.
function scheduleInitializationRetry() {
  clearRetryTimer();
  const delay = retryBackoff.next();
  logger.info(`Retrying the Synology DSM connection in ${Math.round(delay / 1000)}s`);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    initialization = initialize(lastRawConfig).catch(() => {});
  }, delay);
  retryTimer.unref?.();
}

async function initialize(rawConfig) {
  clearRefreshTimer();
  clearRetryTimer();
  lastRawConfig = rawConfig;
  const previousService = service;
  config = normalizeConfig(rawConfig);
  service = new SynologyFleetService(config);
  await previousService?.close();

  try {
    const devices = await service.discover(gladys);
    await gladys.publishDiscoveredDevices(devices);
    await service.publishStates(gladys);
    await gladys.setConnectionStatus(true);
    retryBackoff.reset();
    refreshTimer = setInterval(() => {
      service
        .publishStates(gladys)
        .then(() => gladys.setConnectionStatus(true))
        .catch(async (error) => {
          logger.error('Synology DSM scheduled refresh failed', error);
          await gladys.setConnectionStatus(false, unavailableMessage(error)).catch(() => {});
        });
    }, config.poll_frequency * 1000);
    refreshTimer.unref?.();
    logger.info(`Synology DSM initialized with ${devices.length} device(s)`);
  } catch (error) {
    logger.error('Synology DSM initialization failed', error);
    await gladys.setConnectionStatus(false, unavailableMessage(error)).catch(() => {});
    scheduleInitializationRetry();
    throw error;
  }
}

// The readiness gate must never stay rejected: a failed initialization would otherwise
// break every later handler until the integration is restarted.
async function ready() {
  await initialization;
  if (!service) throw new Error('Synology DSM integration is not connected yet');
  return service;
}

gladys.onScanRequest(async () => {
  const currentService = await ready();
  const devices = await currentService.discover(gladys);
  await gladys.publishDiscoveredDevices(devices);
});

gladys.onPoll(async () => {
  const currentService = await ready();
  try {
    await currentService.publishStates(gladys);
    await gladys.setConnectionStatus(true);
  } catch (error) {
    logger.error('Synology DSM polling failed', error);
    await gladys.setConnectionStatus(false, unavailableMessage(error)).catch(() => {});
    throw error;
  }
});

gladys.onDeviceCreated(async () => {
  const currentService = await ready();
  await currentService.publishStates(gladys, { force: true });
});

gladys.onAction('test_connection', async () => {
  const currentService = await ready();
  const snapshots = await currentService.refresh();
  const summary = snapshots
    .map(
      (snapshot) =>
        `${snapshot.nas.model} (DSM ${snapshot.nas.dsmVersion || 'unknown'}, ${snapshot.volumes.length} volume(s), ${snapshot.disks.length} disk(s), ${snapshot.backups.length} backup task(s))`,
    )
    .join(', ');
  return {
    en: `${snapshots.length} NAS reachable: ${summary}.`,
    fr: `${snapshots.length} NAS joignable(s) : ${summary}.`,
  };
});

gladys.onConfigUpdated((newConfig) => {
  logger.info('Synology configuration updated');
  retryBackoff.reset();
  const run = initialize(newConfig);
  initialization = run.catch(() => {});
  return run;
});

gladys.on('connected', () => {
  retryBackoff.reset();
  initialization = gladys
    .getConfig()
    .then((currentConfig) => initialize(currentConfig))
    .catch((error) => {
      logger.error('Synology DSM startup failed', error);
    });
});

gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  clearRefreshTimer();
  clearRetryTimer();
  await service?.close();
});

logger.info('Starting the Synology integration...');
gladys.connect().catch((error) => {
  logger.error('Initial Gladys connection failed', error);
  process.exit(1);
});
