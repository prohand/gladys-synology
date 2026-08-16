import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG, normalizeConfig, validateConfig } from '../src/config.js';

test('normalizeConfig applies stable defaults and normalizes types', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(
    normalizeConfig({
      url: ' nas.local:5001/// ',
      username: ' gladys ',
      password: 1234,
      verify_ssl: false,
      poll_frequency: '10',
    }),
    {
      url: 'https://nas.local:5001',
      username: 'gladys',
      password: '1234',
      verify_ssl: false,
      poll_frequency: 30,
    },
  );
});

test('validateConfig rejects incomplete or invalid connection details', () => {
  assert.throws(() => validateConfig(normalizeConfig()), /URL is required/);
  assert.throws(
    () => validateConfig(normalizeConfig({ url: 'ftp://nas', username: 'u', password: 'p' })),
    /HTTP or HTTPS/,
  );
});

test('validateConfig accepts a complete DSM configuration', () => {
  assert.doesNotThrow(() =>
    validateConfig(
      normalizeConfig({ url: 'https://nas.local:5001', username: 'u', password: 'p' }),
    ),
  );
});
