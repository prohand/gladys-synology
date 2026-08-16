import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { SynologyFleetService } from './src/fleet-service.js';

const gladys = new GladysIntegration();
let config = normalizeConfig();
let service = null;
let initialization = Promise.resolve();
let refreshTimer = null;

function clearRefreshTimer() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

function unavailableMessage(error) {
  return {
    en: `Unable to monitor Synology DSM: ${error.message}`,
    fr: `Impossible de superviser Synology DSM : ${error.message}`,
  };
}

async function initialize(rawConfig) {
  clearRefreshTimer();
  const previousService = service;
  config = normalizeConfig(rawConfig);
  service = new SynologyFleetService(config);
  await previousService?.close();

  try {
    const devices = await service.discover(gladys);
    await gladys.publishDiscoveredDevices(devices);
    await service.publishStates(gladys);
    await gladys.setConnectionStatus(true);
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
    throw error;
  }
}

gladys.onScanRequest(async () => {
  await initialization;
  const devices = await service.discover(gladys);
  await gladys.publishDiscoveredDevices(devices);
});

gladys.onPoll(async () => {
  await initialization;
  try {
    await service.publishStates(gladys);
    await gladys.setConnectionStatus(true);
  } catch (error) {
    logger.error('Synology DSM polling failed', error);
    await gladys.setConnectionStatus(false, unavailableMessage(error)).catch(() => {});
    throw error;
  }
});

gladys.onDeviceCreated(async () => {
  await initialization;
  await service.publishStates(gladys, { force: true });
});

gladys.onAction('test_connection', async () => {
  await initialization;
  const snapshots = await service.refresh();
  const summary = snapshots
    .map(
      (snapshot) =>
        `${snapshot.nas.model} (DSM ${snapshot.nas.dsmVersion || 'unknown'}, ${snapshot.volumes.length} volume(s), ${snapshot.backups.length} backup task(s))`,
    )
    .join(', ');
  return {
    en: `${snapshots.length} NAS reachable: ${summary}.`,
    fr: `${snapshots.length} NAS joignable(s) : ${summary}.`,
  };
});

gladys.onConfigUpdated((newConfig) => {
  logger.info('Synology configuration updated');
  initialization = initialize(newConfig);
  return initialization;
});

gladys.on('connected', () => {
  initialization = gladys.getConfig().then((currentConfig) => initialize(currentConfig));
  initialization.catch(() => {});
});

gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  clearRefreshTimer();
  await service?.close();
});

logger.info('Starting the Synology integration...');
gladys.connect().catch((error) => {
  logger.error('Initial Gladys connection failed', error);
  process.exit(1);
});
