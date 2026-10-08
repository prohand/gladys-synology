import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createRuntime } from './src/runtime.js';

// Safety net: a promise rejected outside any handler (a timer callback, a background refresh)
// would otherwise kill the container on Node >= 15, and every NAS would stop reporting until the
// supervisor restarts it. Log it and keep running; a real crash (uncaughtException) still ends
// the process.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

const gladys = new GladysIntegration();
createRuntime(gladys);

logger.info('Starting the Synology integration...');
gladys.connect().catch((error) => {
  logger.error('Initial Gladys connection failed', error);
  process.exit(1);
});
