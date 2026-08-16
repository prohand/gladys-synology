export const DEFAULT_CONFIG = {
  url: '',
  username: '',
  password: '',
  otp_code: '',
  verify_ssl: true,
  additional_nas: '',
  poll_frequency: 900,
};

export const MIN_POLL_FREQUENCY = 300;
export const MAX_POLL_FREQUENCY = 86_400;

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
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    url: normalizeUrl(raw.url),
    username: String(raw.username ?? '').trim(),
    password: String(raw.password ?? ''),
    otp_code: String(raw.otp_code ?? '').trim(),
    verify_ssl: raw.verify_ssl !== false,
    additional_nas: String(raw.additional_nas ?? '').trim(),
    poll_frequency: pollFrequency,
  };
}

function connectionConfig(raw, pollFrequency) {
  return {
    url: normalizeUrl(raw.url),
    username: String(raw.username ?? '').trim(),
    password: String(raw.password ?? ''),
    otp_code: String(raw.otp_code ?? '').trim(),
    verify_ssl: raw.verify_ssl !== false,
    poll_frequency: pollFrequency,
  };
}

export function getNasConfigs(config) {
  const connections = [connectionConfig(config, config.poll_frequency)];
  if (!config.additional_nas) return connections;

  let additional;
  try {
    additional = JSON.parse(config.additional_nas);
  } catch {
    throw new Error('Additional NAS configuration must be valid JSON.');
  }
  if (!Array.isArray(additional)) {
    throw new Error('Additional NAS configuration must be a JSON array.');
  }

  additional.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Additional NAS ${index + 1} must be a JSON object.`);
    }
    const connection = connectionConfig(raw, config.poll_frequency);
    try {
      validateConfig(connection);
    } catch (error) {
      throw new Error(`Additional NAS ${index + 1}: ${error.message}`, { cause: error });
    }
    connections.push(connection);
  });
  return connections;
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
