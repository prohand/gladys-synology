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
      date_format: ' European ',
    }),
    {
      url: 'https://nas.local:5001',
      username: 'gladys',
      password: '1234',
      otp_code: '123456',
      verify_ssl: false,
      nas_2_url: '',
      nas_2_username: '',
      nas_2_password: '',
      nas_2_otp_code: '',
      nas_2_verify_ssl: true,
      nas_3_url: '',
      nas_3_username: '',
      nas_3_password: '',
      nas_3_otp_code: '',
      nas_3_verify_ssl: true,
      nas_4_url: '',
      nas_4_username: '',
      nas_4_password: '',
      nas_4_otp_code: '',
      nas_4_verify_ssl: true,
      poll_frequency: 700,
      date_format: 'european',
    },
  );
});

test('normalizeConfig accepts a manual monitoring interval within safe bounds', () => {
  assert.equal(normalizeConfig({ poll_frequency: '731' }).poll_frequency, 731);
  assert.equal(normalizeConfig({ poll_frequency: '60' }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: '30' }).poll_frequency, MIN_POLL_FREQUENCY);
  assert.equal(normalizeConfig({ poll_frequency: '999999' }).poll_frequency, MAX_POLL_FREQUENCY);
});

test('normalizeConfig only accepts an offered date format', () => {
  assert.equal(normalizeConfig().date_format, DEFAULT_CONFIG.date_format);
  assert.equal(normalizeConfig({ date_format: 'us' }).date_format, 'us');
  assert.equal(normalizeConfig({ date_format: 'dd-mm' }).date_format, DEFAULT_CONFIG.date_format);
});

test('getNasConfigs builds additional NAS connections from dedicated secret slots', () => {
  const config = normalizeConfig({
    url: 'https://nas1:5001',
    username: 'one',
    password: 'password-one',
    poll_frequency: 731,
    date_format: 'european',
    nas_2_url: 'nas2:5001',
    nas_2_username: 'two',
    nas_2_password: 'password-two',
    nas_2_otp_code: '123456',
    nas_2_verify_ssl: false,
  });
  const connections = getNasConfigs(config);
  assert.equal(connections.length, 2);
  assert.equal(connections[1].url, 'https://nas2:5001');
  assert.equal(connections[1].poll_frequency, 731);
  assert.equal(connections[1].verify_ssl, false);
  // Display settings are integration-wide: every NAS publishes its dates the same way.
  assert.ok(connections.every((connection) => connection.date_format === 'european'));
});

test('getNasConfigs ignores empty slots and rejects incomplete additional NAS fields', () => {
  const base = { url: 'https://nas', username: 'u', password: 'p' };
  assert.equal(getNasConfigs(normalizeConfig(base)).length, 1);
  const legacy = normalizeConfig({
    ...base,
    additional_nas: '[{"url":"nas2","username":"u","password":"visible"}]',
  });
  assert.equal(legacy.additional_nas, undefined);
  assert.equal(getNasConfigs(legacy).length, 1);
  assert.throws(
    () => getNasConfigs(normalizeConfig({ ...base, nas_2_url: 'nas2' })),
    /NAS 2.*username/i,
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
