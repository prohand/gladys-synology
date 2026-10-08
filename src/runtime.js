import { logger } from '@gladysassistant/integration-sdk';
import { createBackoff } from './backoff.js';
import { ConfigValidationError, normalizeConfig } from './config.js';
import { SynologyFleetService } from './fleet-service.js';
import { getBackupStatus, getNasStatus, getVolumeStatus, SCENE_ACTION } from './scene-actions.js';
import { buildWidgetContent, WIDGET } from './widgets/index.js';

const defaultScheduler = { setTimeout, clearTimeout, setInterval, clearInterval };

// A snapshot this young is replayed when a device is added instead of reading DSM again: adding a
// whole NAS from the Discovery screen creates one device per volume, disk and backup task.
export const DEVICE_CREATED_SNAPSHOT_MAX_AGE_MS = 30_000;

function unavailableMessage(error) {
  return {
    en: `Unable to monitor Synology DSM: ${error.message}`,
    fr: `Impossible de superviser Synology DSM : ${error.message}`,
  };
}

// DSM reports firmware_ver as "DSM 7.2.2-72806", so prefixing it again would read "DSM DSM 7.2.2".
function dsmLabel(version) {
  if (!version) return 'DSM unknown';
  return /^dsm\b/i.test(version) ? version : `DSM ${version}`;
}

function degradedMessage(failures) {
  const detail = failures.map((failure) => `${failure.url} (${failure.error.message})`).join(', ');
  return {
    en: `${failures.length} Synology NAS unreachable: ${detail}`,
    fr: `${failures.length} NAS Synology injoignable(s) : ${detail}`,
  };
}

/**
 * Wires the Gladys SDK handlers to the Synology fleet: refresh loop, self-healing reconnection
 * and connection status reporting. Kept out of index.js so the orchestration stays testable.
 */
export function createRuntime(
  gladys,
  {
    serviceFactory = (nasConfig) => new SynologyFleetService(nasConfig),
    backoff = createBackoff(),
    scheduler = defaultScheduler,
  } = {},
) {
  let config = normalizeConfig();
  let service = null;
  // Tail of the initialization queue; never rejects (see `ready()`).
  let initialization = Promise.resolve();
  let refreshTimer = null;
  let retryTimer = null;
  let lastRawConfig = null;

  function clearRefreshTimer() {
    if (refreshTimer) scheduler.clearInterval(refreshTimer);
    refreshTimer = null;
  }

  function clearRetryTimer() {
    if (retryTimer) scheduler.clearTimeout(retryTimer);
    retryTimer = null;
  }

  async function closeQuietly(target) {
    try {
      await target?.close();
    } catch (error) {
      logger.warn(`Unable to close the previous Synology connection: ${error.message}`);
    }
  }

  // A single unreachable NAS must not report the whole integration as offline: the other ones
  // keep publishing, and the failure is named in the status message instead.
  async function reportStatus() {
    const failures = service?.lastFailures ?? [];
    if (failures.length === 0) return gladys.setConnectionStatus(true);
    for (const failure of failures) {
      logger.warn(`Synology DSM unreachable on ${failure.url}: ${failure.error.message}`);
    }
    return gladys.setConnectionStatus(true, degradedMessage(failures));
  }

  // Widgets are pulled from the snapshots in memory: after a refresh cycle, ask Gladys to pull
  // them again instead of waiting for their TTL. Rate-limited by the core, dropped while offline.
  function refreshWidgets() {
    for (const key of Object.values(WIDGET)) {
      try {
        gladys.requestWidgetRefresh(key);
      } catch (error) {
        logger.warn(`Unable to refresh the ${key} widget: ${error.message}`);
      }
    }
  }

  async function reportUnavailable(error) {
    await gladys.setConnectionStatus(false, unavailableMessage(error)).catch(() => {});
  }

  // A NAS reboot, a DSM update or a temporary network outage makes the first connection fail.
  // Retrying on our own keeps the integration self-healing instead of waiting for a manual restart.
  function scheduleInitializationRetry() {
    clearRetryTimer();
    const delay = backoff.next();
    logger.info(`Retrying the Synology DSM connection in ${Math.round(delay / 1000)}s`);
    retryTimer = scheduler.setTimeout(() => {
      retryTimer = null;
      initialize(lastRawConfig).catch(() => {});
    }, delay);
    retryTimer.unref?.();
  }

  // Initializations run one after the other. `connected` and `onConfigUpdated` routinely arrive
  // together (a Save right after a reconnection): run concurrently, the second one closed the fleet
  // the first was still discovering with, and both armed a refresh interval while only the last one
  // could ever be cleared — a leaked timer polling a closed connection forever.
  function enqueue(task) {
    const run = initialization.then(task);
    initialization = run.catch(() => {});
    return run;
  }

  function initialize(rawConfig) {
    return enqueue(() => performInitialize(rawConfig));
  }

  async function performInitialize(rawConfig) {
    clearRefreshTimer();
    clearRetryTimer();
    lastRawConfig = rawConfig;
    const previousService = service;
    config = normalizeConfig(rawConfig);

    try {
      service = serviceFactory(config);
    } catch (error) {
      // Building the fleet validates the configuration, so this is the path taken by an empty or
      // wrong setup: it has to reach the Gladys UI, and retrying cannot fix it.
      service = null;
      await closeQuietly(previousService);
      logger.error('Synology DSM configuration rejected', error);
      await reportUnavailable(error);
      if (!(error instanceof ConfigValidationError)) scheduleInitializationRetry();
      throw error;
    }
    await closeQuietly(previousService);

    try {
      const devices = await service.discover(gladys);
      await gladys.publishDiscoveredDevices(devices);
      await service.publishStates(gladys);
      await reportStatus();
      refreshWidgets();
      backoff.reset();
      const refreshed = service;
      clearRefreshTimer();
      refreshTimer = scheduler.setInterval(() => {
        refreshed
          .publishStates(gladys)
          .then(() => (service === refreshed ? reportStatus() : undefined))
          .catch(async (error) => {
            // A cycle still running on a fleet a new configuration replaced must not report the
            // new one as offline.
            if (service !== refreshed) return;
            logger.error('Synology DSM scheduled refresh failed', error);
            await reportUnavailable(error);
          })
          .finally(() => refreshWidgets());
      }, config.poll_frequency * 1000);
      refreshTimer.unref?.();
      logger.info(`Synology DSM initialized with ${devices.length} device(s)`);
    } catch (error) {
      logger.error('Synology DSM initialization failed', error);
      await reportUnavailable(error);
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
    await reportStatus();
  });

  gladys.onPoll(async () => {
    const currentService = await ready();
    try {
      await currentService.publishStates(gladys);
      await reportStatus();
    } catch (error) {
      logger.error('Synology DSM polling failed', error);
      await reportUnavailable(error);
      throw error;
    } finally {
      refreshWidgets();
    }
  });

  gladys.onDeviceCreated(async () => {
    const currentService = await ready();
    await currentService.publishStates(gladys, {
      force: true,
      maxSnapshotAgeMs: DEVICE_CREATED_SNAPSHOT_MAX_AGE_MS,
    });
  });

  gladys.onAction('test_connection', async () => {
    const currentService = await ready();
    const snapshots = await currentService.refresh();
    const summary = snapshots
      .map(
        (snapshot) =>
          `${snapshot.nas.model} (${dsmLabel(snapshot.nas.dsmVersion)}, ${snapshot.volumes.length} volume(s), ${snapshot.disks.length} disk(s), ${snapshot.backups.length} backup task(s))`,
      )
      .join(', ');
    const failures = currentService.lastFailures ?? [];
    const unreachable =
      failures.length === 0
        ? { en: '', fr: '' }
        : {
            en: ` ${failures.length} NAS unreachable: ${failures.map((failure) => failure.url).join(', ')}.`,
            fr: ` ${failures.length} NAS injoignable(s) : ${failures.map((failure) => failure.url).join(', ')}.`,
          };
    return {
      en: `${snapshots.length} NAS reachable: ${summary}.${unreachable.en}`,
      fr: `${snapshots.length} NAS joignable(s) : ${summary}.${unreachable.fr}`,
    };
  });

  const sceneActions = {
    [SCENE_ACTION.NAS_STATUS]: getNasStatus,
    [SCENE_ACTION.VOLUME_STATUS]: getVolumeStatus,
    [SCENE_ACTION.BACKUP_STATUS]: getBackupStatus,
  };
  for (const [key, run] of Object.entries(sceneActions)) {
    gladys.onSceneAction(key, async (fields) => run(await ready(), gladys, fields));
  }

  // No `ready()` here: a widget must answer within 15 s, while a first connection to an
  // unreachable NAS can take longer. The content explains the situation instead.
  for (const key of Object.values(WIDGET)) {
    gladys.onWidgetGet(key, async ({ settings, units } = {}) =>
      buildWidgetContent(key, {
        gladys,
        fleet: service,
        settings,
        units,
        pollFrequency: config.poll_frequency,
      }),
    );
  }

  gladys.onConfigUpdated((newConfig) => {
    logger.info('Synology configuration updated');
    backoff.reset();
    return initialize(newConfig);
  });

  gladys.on('connected', () => {
    backoff.reset();
    // Read the configuration inside the queue, so a Save handled meanwhile is not overwritten by
    // the older configuration this read would return.
    enqueue(async () => performInitialize(await gladys.getConfig())).catch((error) => {
      logger.error('Synology DSM startup failed', error);
    });
  });

  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    clearRefreshTimer();
    clearRetryTimer();
    await closeQuietly(service);
  });

  return {
    initialize,
    ready,
    getService: () => service,
    getConfig: () => config,
  };
}
