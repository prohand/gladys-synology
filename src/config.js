export const DEFAULT_CONFIG = {
  url: '',
  username: '',
  password: '',
  otp_code: '',
  verify_ssl: true,
  poll_frequency: 900,
};

const SUPPORTED_POLL_FREQUENCIES = [300, 900, 3600];

function normalizeUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, '');
}

export function normalizeConfig(raw = {}) {
  const requestedFrequency = Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency);
  const pollFrequency = SUPPORTED_POLL_FREQUENCIES.includes(requestedFrequency)
    ? requestedFrequency
    : DEFAULT_CONFIG.poll_frequency;
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    url: normalizeUrl(raw.url),
    username: String(raw.username ?? '').trim(),
    password: String(raw.password ?? ''),
    otp_code: String(raw.otp_code ?? '').trim(),
    verify_ssl: raw.verify_ssl !== false,
    poll_frequency: pollFrequency,
  };
}

export function validateConfig(config) {
  if (!config.url) throw new Error('The Synology DSM URL is required.');
  if (!config.username) throw new Error('The Synology DSM username is required.');
  if (!config.password) throw new Error('The Synology DSM password is required.');
  if (config.otp_code && !/^\d{6}$/.test(config.otp_code)) {
    throw new Error('The Synology DSM OTP code must contain exactly 6 digits.');
  }

  let url;
  try {
    url = new URL(config.url);
  } catch {
    throw new Error('The Synology DSM URL is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('The Synology DSM URL must use HTTP or HTTPS.');
  }
}
