import { createLogger } from '@gladysassistant/integration-sdk';
import { validateConfig } from './config.js';
import { buildDiscoveredDevices, buildStates, findDevice } from './devices/index.js';
import { SceneEventTracker } from './scene-events.js';
import { SynologyClient } from './synology/client.js';
import { normalizeSnapshot } from './synology/metrics.js';

const logger = createLogger({ name: 'synology' });

// A refresh timer can fire a few milliseconds early; without this tolerance the throttle would
// reject that cycle and the next publication would land a full interval later.
export const PUBLISH_THROTTLE_RATIO = 0.95;

export class SynologyService {
  constructor(
    config,
    { clientFactory = (clientConfig) => new SynologyClient(clientConfig), now = Date.now } = {},
  ) {
    validateConfig(config);
    this.config = config;
    this.client = clientFactory(config);
    this.now = now;
    this.snapshot = null;
    this.inFlightRefresh = null;
    this.lastPublishedAt = null;
    this.lastError = null;
    this.sceneEvents = new SceneEventTracker({ now });
  }

  get nasId() {
    return this.snapshot?.nas.serial || new URL(this.config.url).hostname.toLowerCase();
  }

  async refresh() {
    if (!this.inFlightRefresh) {
      this.inFlightRefresh = this.client
        .getSnapshot()
        .then((snapshot) => normalizeSnapshot(snapshot))
        .then((snapshot) => {
          this.snapshot = snapshot;
          this.lastError = null;
          return snapshot;
        })
        .catch((error) => {
          this.lastError = error;
          throw error;
        })
        .finally(() => {
          this.inFlightRefresh = null;
        });
    }
    return this.inFlightRefresh;
  }

  async discover(gladys, { refresh = true } = {}) {
    const snapshot = refresh || !this.snapshot ? await this.refresh() : this.snapshot;
    return buildDiscoveredDevices(gladys, this.nasId, snapshot);
  }

  async publishStates(gladys, { force = false } = {}) {
    const now = this.now();
    if (
      !force &&
      this.lastPublishedAt !== null &&
      now - this.lastPublishedAt < this.config.poll_frequency * 1000 * PUBLISH_THROTTLE_RATIO
    ) {
      return this.snapshot;
    }

    let snapshot;
    try {
      snapshot = await this.refresh();
    } catch (error) {
      await this.publishSceneEvents(
        gladys,
        this.sceneEvents.observeFailure(gladys, this.eventContext(), this.snapshot, error),
      );
      throw error;
    }
    const states = buildStates(gladys, this.nasId, snapshot, {
      dateFormat: this.config.date_format,
    });
    if (states.length > 0) await gladys.publishStates(states);
    this.lastPublishedAt = now;
    logger.info(`Published ${states.length} Synology monitoring values`);
    // Events are only derived from this monitoring loop, never from a refresh requested by a
    // scene action: a scene bound to an event must not be able to loop through the integration.
    await this.publishSceneEvents(
      gladys,
      this.sceneEvents.observe(gladys, this.eventContext(), snapshot),
    );
    return snapshot;
  }

  eventContext() {
    return { nasId: this.nasId, url: this.config.url, dateFormat: this.config.date_format };
  }

  // A refused event (Gladys restarting, rate limit) must never break the state publication.
  async publishSceneEvents(gladys, events) {
    for (const { key, data } of events) {
      try {
        await gladys.publishSceneEvent(key, data);
        logger.info(`Scene event ${key} published`);
      } catch (error) {
        logger.warn(`Unable to publish the ${key} scene event: ${error.message}`);
      }
    }
  }

  /** The snapshot entry behind a device external_id of this NAS, or `null`. */
  findDevice(gladys, externalId) {
    return findDevice(gladys, this.nasId, this.snapshot, externalId);
  }

  async close() {
    await this.client.close();
  }
}
