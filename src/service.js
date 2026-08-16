import { createLogger } from '@gladysassistant/integration-sdk';
import { validateConfig } from './config.js';
import { buildDiscoveredDevices, buildStates } from './devices/index.js';
import { SynologyClient } from './synology/client.js';
import { normalizeSnapshot } from './synology/metrics.js';

const logger = createLogger({ name: 'synology' });

export class SynologyService {
  constructor(config, { clientFactory = (clientConfig) => new SynologyClient(clientConfig) } = {}) {
    validateConfig(config);
    this.config = config;
    this.client = clientFactory(config);
    this.snapshot = null;
    this.inFlightRefresh = null;
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
    return buildDiscoveredDevices(gladys, this.nasId, snapshot, this.config);
  }

  async publishStates(gladys) {
    const snapshot = await this.refresh();
    const states = buildStates(gladys, this.nasId, snapshot);
    if (states.length > 0) await gladys.publishStates(states);
    logger.info(`Published ${states.length} Synology monitoring values`);
    return snapshot;
  }

  async close() {
    await this.client.close();
  }
}
