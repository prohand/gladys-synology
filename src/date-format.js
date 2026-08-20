/**
 * Display formats offered for the dates published to Gladys (currently the last backup time).
 * `iso` is the historical value and stays the default: silently rewriting it would break the
 * text already stored for every existing backup device.
 */
export const DATE_FORMATS = ['iso', 'iso_local', 'european', 'us'];
export const DEFAULT_DATE_FORMAT = 'iso';

function pad(value) {
  return String(value).padStart(2, '0');
}

export function normalizeDateFormat(value) {
  const format = String(value ?? '')
    .trim()
    .toLowerCase();
  return DATE_FORMATS.includes(format) ? format : DEFAULT_DATE_FORMAT;
}

/**
 * Formats an ISO 8601 timestamp for display. Every format but `iso` renders the local time of the
 * integration container (the `TZ` environment variable), which is what a user reads on the NAS.
 * A value DSM did not report as a real date is returned untouched rather than replaced.
 */
export function formatDate(value, format = DEFAULT_DATE_FORMAT) {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = normalizeDateFormat(format);
  if (normalized === 'iso') return String(value);

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const minutes = pad(date.getMinutes());
  const hours = date.getHours();

  if (normalized === 'iso_local') return `${year}-${month}-${day} ${pad(hours)}:${minutes}`;
  if (normalized === 'european') return `${day}/${month}/${year} ${pad(hours)}:${minutes}`;
  const meridiem = hours < 12 ? 'AM' : 'PM';
  return `${month}/${day}/${year} ${pad(hours % 12 || 12)}:${minutes} ${meridiem}`;
}
