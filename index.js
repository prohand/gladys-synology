import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createRuntime } from './src/runtime.js';

const gladys = new GladysIntegration();
createRuntime(gladys);

logger.info('Starting the Synology integration...');
gladys.connect().catch((error) => {
  logger.error('Initial Gladys connection failed', error);
  process.exit(1);
});
