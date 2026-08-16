import { getNasConfigs } from './config.js';
import { SynologyService } from './service.js';

export class SynologyFleetService {
  constructor(config, options = {}) {
    this.config = config;
    this.services = getNasConfigs(config).map(
      (nasConfig) => new SynologyService(nasConfig, options),
    );
    this.lastErrors = [];
  }

  async run(method, ...args) {
    const settled = await Promise.allSettled(
      this.services.map((service) => service[method](...args)),
    );
    const values = settled
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    this.lastErrors = settled
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    if (values.length === 0 && this.lastErrors.length > 0) throw this.lastErrors[0];
    return values;
  }

  async discover(gladys) {
    const devices = await this.run('discover', gladys);
    return devices.flat();
  }

  async publishStates(gladys, options) {
    return this.run('publishStates', gladys, options);
  }

  async refresh() {
    return this.run('refresh');
  }

  async close() {
    await Promise.allSettled(this.services.map((service) => service.close()));
  }
}
