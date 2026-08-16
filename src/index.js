import { loadConfig } from './config.js';
import { SynologyClient } from './synology-client.js';
import { GladysClient } from './gladys-client.js';
import { metricsToDevices } from './features.js';

export async function run(config, { synology, gladys } = {}) {
  const dsm = synology ?? new SynologyClient(config.synology);
  const assistant = gladys ?? new GladysClient(config.gladys);
  const collect = async () => {
    try {
      const metrics = await dsm.collect({ hyperBackup: config.enableHyperBackup });
      for (const device of metricsToDevices(metrics)) await assistant.publish(device);
      console.info(`[synology] ${new Date().toISOString()} collecte publiée`);
    } catch (error) {
      console.error(`[synology] ${new Date().toISOString()} ${error.message}`);
    }
  };
  await collect();
  return setInterval(collect, config.pollIntervalMs);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) run(loadConfig());
