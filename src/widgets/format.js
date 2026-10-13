import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';

const TTL_MIN_SECONDS = 10;
const TTL_MAX_SECONDS = 3600;

/** The content moves at the pace of the refresh loop; the runtime nudges it after each cycle. */
export function contentTtl(pollFrequency) {
  return Math.min(TTL_MAX_SECONDS, Math.max(TTL_MIN_SECONDS, Math.round(pollFrequency)));
}

export function truncate(text, length) {
  const value = String(text ?? '');
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

// French, German and Spanish write a decimal comma.
const DECIMAL_COMMA = new Set(['fr', 'de', 'es']);

function decimal(value, language) {
  const rounded = Math.round(value * 10) / 10;
  return DECIMAL_COMMA.has(language) ? String(rounded).replace('.', ',') : String(rounded);
}

// French writes "octet" units (To, Go, Mo); German and Spanish keep the byte symbols.
const SIZE_UNITS = [
  { size: 1024 ** 4, en: 'TB', fr: 'To', de: 'TB', es: 'TB' },
  { size: 1024 ** 3, en: 'GB', fr: 'Go', de: 'GB', es: 'GB' },
  { size: 1024 ** 2, en: 'MB', fr: 'Mo', de: 'MB', es: 'MB' },
];

/** A byte count as a short multi-language text: `{ en: '1.8 TB', fr: '1,8 To', de: '1,8 TB', … }`. */
export function formatSize(bytes) {
  const unit = SIZE_UNITS.find(({ size }) => bytes >= size) ?? SIZE_UNITS[SIZE_UNITS.length - 1];
  return Object.fromEntries(
    ['en', 'fr', 'de', 'es'].map((language) => [
      language,
      `${decimal(bytes / unit.size, language)} ${unit[language]}`,
    ]),
  );
}

/** DSM always reports °C; a dashboard set to US units reads °F. */
export function temperature(celsius, units) {
  if (units === 'us') return { value: Math.round(celsius * 1.8 + 32), unit: '°F' };
  return { value: Math.round(celsius), unit: '°C' };
}

export function thresholdColor(value, warning, danger) {
  if (value === undefined) return WIDGET_COLORS.NEUTRAL;
  if (value >= danger) return WIDGET_COLORS.DANGER;
  if (value >= warning) return WIDGET_COLORS.WARNING;
  return WIDGET_COLORS.SUCCESS;
}

export function volumeColor(volume) {
  if (volume.healthy === 0) return WIDGET_COLORS.DANGER;
  if (volume.healthy === undefined && volume.usagePercent === undefined) return WIDGET_COLORS.INFO;
  return thresholdColor(volume.usagePercent, 80, 90);
}

export const UNREACHABLE_ROW = {
  label: { en: 'Connection', fr: 'Connexion', de: 'Verbindung', es: 'Conexión' },
  value: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
  icon: 'wifi-off',
  color: WIDGET_COLORS.DANGER,
};

/** A content made of a single message, for the states where there is nothing to show yet. */
export function messageContent(message, pollFrequency, extra = []) {
  return {
    ttl_seconds: contentTtl(pollFrequency),
    components: [{ type: 'text', variant: 'body', text: message }, ...extra],
  };
}
