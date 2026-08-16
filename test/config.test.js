import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const valid = { SYNOLOGY_URL: 'https://nas/', SYNOLOGY_USERNAME: 'user', SYNOLOGY_PASSWORD: 'pass', GLADYS_URL: 'http://gladys/', GLADYS_TOKEN: 'token' };

test('loadConfig validates and normalizes configuration', () => {
  const config = loadConfig({ ...valid, POLL_INTERVAL: '30', ENABLE_HYPER_BACKUP: 'true' });
  assert.equal(config.synology.baseUrl, 'https://nas');
  assert.equal(config.gladys.baseUrl, 'http://gladys');
  assert.equal(config.pollIntervalMs, 30_000);
  assert.equal(config.enableHyperBackup, true);
});

test('loadConfig rejects missing values and excessive polling', () => {
  assert.throws(() => loadConfig({}), /Variables requises/);
  assert.throws(() => loadConfig({ ...valid, POLL_INTERVAL: '10' }), /15 secondes/);
});
