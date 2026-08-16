import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_CONFIG,
  MAX_POLL_FREQUENCY,
  MIN_POLL_FREQUENCY,
  getNasConfigs,
  normalizeConfig,
  validateConfig,
} from '../src/config.js';

test('normalizeConfig applies stable defaults and normalizes types', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(
    normalizeConfig({
      url: ' nas.local:5001/// ',
      username: ' gladys ',
      password: 1234,
      otp_code: ' 123456 ',
      verify_ssl: false,
      poll_frequency: '700',
    }),
    {
      url: 'https://nas.local:5001',
      username: 'gladys',
      password: '1234',
      otp_code: '123456',
      verify_ssl: false,
      additional_nas: '',
      poll_frequency: 700,
    },
  );
});

test('normalizeConfig accepts a manual monitoring interval within safe bounds', () => {
  assert.equal(normalizeConfig({ poll_frequency: '731' }).poll_frequency, 731);
  assert.equal(normalizeConfig({ poll_frequency: '60' }).poll_frequency, MIN_POLL_FREQUENCY);
  assert.equal(normalizeConfig({ poll_frequency: '999999' }).poll_frequency, MAX_POLL_FREQUENCY);
});

test('getNasConfigs parses additional NAS connections with the shared interval', () => {
  const config = normalizeConfig({
    url: 'https://nas1:5001',
    username: 'one',
    password: 'password-one',
    poll_frequency: 731,
    additional_nas: JSON.stringify([
      {
        url: 'nas2:5001',
        username: 'two',
        password: 'password-two',
        otp_code: '123456',
        verify_ssl: false,
      },
    ]),
  });
  const connections = getNasConfigs(config);
  assert.equal(connections.length, 2);
  assert.equal(connections[1].url, 'https://nas2:5001');
  assert.equal(connections[1].poll_frequency, 731);
  assert.equal(connections[1].verify_ssl, false);
});

test('getNasConfigs rejects malformed additional NAS configuration', () => {
  const base = { url: 'https://nas', username: 'u', password: 'p' };
  assert.throws(
    () => getNasConfigs(normalizeConfig({ ...base, additional_nas: 'not-json' })),
    /valid JSON/,
  );
  assert.throws(
    () => getNasConfigs(normalizeConfig({ ...base, additional_nas: '[{"url":"nas2"}]' })),
    /Additional NAS 1.*username/i,
  );
});

test('validateConfig rejects incomplete or invalid connection details', () => {
  assert.throws(() => validateConfig(normalizeConfig()), /URL is required/);
  assert.throws(
    () => validateConfig(normalizeConfig({ url: 'ftp://nas', username: 'u', password: 'p' })),
    /HTTP or HTTPS/,
  );
  assert.throws(
    () =>
      validateConfig(
        normalizeConfig({
          url: 'https://nas',
          username: 'u',
          password: 'p',
          otp_code: '12345',
        }),
      ),
    /exactly 6 digits/,
  );
});

test('validateConfig accepts a complete DSM configuration', () => {
  assert.doesNotThrow(() =>
    validateConfig(
      normalizeConfig({ url: 'https://nas.local:5001', username: 'u', password: 'p' }),
    ),
  );
});
