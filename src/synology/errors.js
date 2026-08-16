export class SynologyApiError extends Error {
  constructor(message, { code, api, cause } = {}) {
    super(message, { cause });
    this.name = 'SynologyApiError';
    this.code = code;
    this.api = api;
  }
}

const DSM_ERROR_MESSAGES = new Map([
  [100, 'Unknown DSM API error'],
  [101, 'Invalid DSM API parameter'],
  [102, 'Requested DSM API does not exist'],
  [103, 'Requested DSM API method does not exist'],
  [104, 'Requested DSM API version is unsupported'],
  [105, 'Insufficient DSM user privileges; add the account to the administrators group'],
  [106, 'DSM session timed out'],
  [107, 'DSM session was interrupted'],
  [400, 'Invalid DSM credentials'],
  [401, 'DSM account is disabled'],
  [402, 'DSM permission denied'],
  [
    403,
    'DSM two-factor authentication code is required; enter a current OTP in the integration settings',
  ],
  [404, 'DSM two-factor authentication code is invalid or expired'],
  [406, 'DSM enforces two-factor authentication; enter a current OTP in the integration settings'],
  [407, 'DSM IP address is blocked'],
  [408, 'DSM password has expired'],
  [409, 'DSM password must be changed'],
  [410, 'DSM password must be changed'],
]);

export function apiError(api, code) {
  const detail = DSM_ERROR_MESSAGES.get(code) ?? `DSM API error ${code}`;
  return new SynologyApiError(`${detail} (${api})`, { api, code });
}
