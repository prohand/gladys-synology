import { DEFAULT_DATE_FORMAT, normalizeDateFormat } from './date-format.js';

/**
 * Raised when the integration configuration itself is wrong. The runtime reports it to Gladys
 * but does not retry: only a new configuration can fix it.
 */
export class ConfigValidationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ConfigValidationError';
  }
}

export const DEFAULT_CONFIG = {
  url: '',
  username: '',
  password: '',
  otp_code: '',
  verify_ssl: true,
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
  poll_frequency: 900,
  date_format: DEFAULT_DATE_FORMAT,
};

export const MIN_POLL_FREQUENCY = 60;
export const MAX_POLL_FREQUENCY = 86_400;
export const ADDITIONAL_NAS_SLOTS = [2, 3, 4];

function normalizeUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, '');
}

export function normalizeConfig(raw = {}) {
  const requestedFrequency = Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency);
  const pollFrequency = Number.isFinite(requestedFrequency)
    ? Math.min(MAX_POLL_FREQUENCY, Math.max(MIN_POLL_FREQUENCY, Math.round(requestedFrequency)))
    : DEFAULT_CONFIG.poll_frequency;
  const config = {
    ...DEFAULT_CONFIG,
    url: normalizeUrl(raw.url),
    username: String(raw.username ?? '').trim(),
    password: String(raw.password ?? ''),
    otp_code: String(raw.otp_code ?? '').trim(),
    verify_ssl: raw.verify_ssl !== false,
    poll_frequency: pollFrequency,
    date_format: normalizeDateFormat(raw.date_format),
  };
  for (const slot of ADDITIONAL_NAS_SLOTS) {
    config[`nas_${slot}_url`] = normalizeUrl(raw[`nas_${slot}_url`]);
    config[`nas_${slot}_username`] = String(raw[`nas_${slot}_username`] ?? '').trim();
    config[`nas_${slot}_password`] = String(raw[`nas_${slot}_password`] ?? '');
    config[`nas_${slot}_otp_code`] = String(raw[`nas_${slot}_otp_code`] ?? '').trim();
    config[`nas_${slot}_verify_ssl`] = raw[`nas_${slot}_verify_ssl`] !== false;
  }
  return config;
}

function connectionConfig(raw, { pollFrequency, dateFormat }) {
  return {
    url: normalizeUrl(raw.url),
    username: String(raw.username ?? '').trim(),
    password: String(raw.password ?? ''),
    otp_code: String(raw.otp_code ?? '').trim(),
    verify_ssl: raw.verify_ssl !== false,
    poll_frequency: pollFrequency,
    date_format: normalizeDateFormat(dateFormat),
  };
}

export function getNasConfigs(config) {
  // Display settings are integration-wide: every NAS publishes its dates the same way.
  const shared = { pollFrequency: config.poll_frequency, dateFormat: config.date_format };
  const connections = [connectionConfig(config, shared)];
  for (const slot of ADDITIONAL_NAS_SLOTS) {
    const raw = {
      url: config[`nas_${slot}_url`],
      username: config[`nas_${slot}_username`],
      password: config[`nas_${slot}_password`],
      otp_code: config[`nas_${slot}_otp_code`],
      verify_ssl: config[`nas_${slot}_verify_ssl`],
    };
    if (!raw.url && !raw.username && !raw.password && !raw.otp_code) continue;
    const connection = connectionConfig(raw, shared);
    try {
      validateConfig(connection);
    } catch (error) {
      throw new ConfigValidationError(`NAS ${slot}: ${error.message}`, { cause: error });
    }
    connections.push(connection);
  }
  return connections;
}

export function validateConfig(config) {
  if (!config.url) throw new ConfigValidationError('The Synology DSM URL is required.');
  if (!config.username) throw new ConfigValidationError('The Synology DSM username is required.');
  if (!config.password) throw new ConfigValidationError('The Synology DSM password is required.');
  if (config.otp_code && !/^\d{6}$/.test(config.otp_code)) {
    throw new ConfigValidationError('The Synology DSM OTP code must contain exactly 6 digits.');
  }

  let url;
  try {
    url = new URL(config.url);
  } catch {
    throw new ConfigValidationError('The Synology DSM URL is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ConfigValidationError('The Synology DSM URL must use HTTP or HTTPS.');
  }
}
