export const DEFAULT_CONFIG = {
  url: '',
  username: '',
  password: '',
  verify_ssl: true,
  poll_frequency: 60,
};

const SUPPORTED_POLL_FREQUENCIES = [30, 60];

function normalizeUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, '');
}

export function normalizeConfig(raw = {}) {
  const requestedFrequency = Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency);
  const pollFrequency = Number.isFinite(requestedFrequency)
    ? SUPPORTED_POLL_FREQUENCIES.reduce((closest, frequency) =>
        Math.abs(frequency - requestedFrequency) < Math.abs(closest - requestedFrequency)
          ? frequency
          : closest,
      )
    : DEFAULT_CONFIG.poll_frequency;
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    url: normalizeUrl(raw.url),
    username: String(raw.username ?? '').trim(),
    password: String(raw.password ?? ''),
    verify_ssl: raw.verify_ssl !== false,
    poll_frequency: pollFrequency,
  };
}

export function validateConfig(config) {
  if (!config.url) throw new Error('The Synology DSM URL is required.');
  if (!config.username) throw new Error('The Synology DSM username is required.');
  if (!config.password) throw new Error('The Synology DSM password is required.');

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
