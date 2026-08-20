import { createLogger } from '@gladysassistant/integration-sdk';
import { validateConfig } from './config.js';
import { buildDiscoveredDevices, buildStates } from './devices/index.js';
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
          return snapshot;
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

    const snapshot = await this.refresh();
    const states = buildStates(gladys, this.nasId, snapshot, {
      dateFormat: this.config.date_format,
    });
    if (states.length > 0) await gladys.publishStates(states);
    this.lastPublishedAt = now;
    logger.info(`Published ${states.length} Synology monitoring values`);
    return snapshot;
  }

  async close() {
    await this.client.close();
  }
}
