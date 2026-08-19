import { getNasConfigs } from './config.js';
import { SynologyService } from './service.js';

export class SynologyFleetService {
  constructor(config, options = {}) {
    this.config = config;
    this.services = getNasConfigs(config).map(
      (nasConfig) => new SynologyService(nasConfig, options),
    );
    this.lastFailures = [];
  }

  async run(method, ...args) {
    const settled = await Promise.allSettled(
      this.services.map((service) => service[method](...args)),
    );
    const values = settled
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    // A NAS that is down must not hide the ones that answered, but the caller still has to know
    // about it: the failures stay readable until the next run.
    this.lastFailures = settled
      .map((result, index) => ({ result, service: this.services[index] }))
      .filter(({ result }) => result.status === 'rejected')
      .map(({ result, service }) => ({ url: service.config.url, error: result.reason }));
    if (values.length === 0 && this.lastFailures.length > 0) throw this.lastFailures[0].error;
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
