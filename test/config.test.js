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
      poll_frequency: 900,
    },
  );
});

test('normalizeConfig only returns supported monitoring intervals', () => {
  assert.equal(normalizeConfig({ poll_frequency: '300' }).poll_frequency, 300);
  assert.equal(normalizeConfig({ poll_frequency: '900' }).poll_frequency, 900);
  assert.equal(normalizeConfig({ poll_frequency: '3600' }).poll_frequency, 3600);
  assert.equal(normalizeConfig({ poll_frequency: '60' }).poll_frequency, 900);
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
