import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DATE_FORMATS,
  DEFAULT_DATE_FORMAT,
  formatDate,
  normalizeDateFormat,
} from '../src/date-format.js';

// The formats other than ISO 8601 render local time: pinning the zone keeps the test stable.
process.env.TZ = 'Europe/Paris';

const lastBackupAt = '2026-08-20T13:08:00.000Z';

test('normalizeDateFormat keeps known formats and falls back to the default', () => {
  for (const format of DATE_FORMATS) assert.equal(normalizeDateFormat(format), format);
  assert.equal(normalizeDateFormat(' European '), 'european');
  assert.equal(normalizeDateFormat('klingon'), DEFAULT_DATE_FORMAT);
  assert.equal(normalizeDateFormat(undefined), DEFAULT_DATE_FORMAT);
  assert.equal(DEFAULT_DATE_FORMAT, 'iso');
});

test('formatDate renders every offered format from the same timestamp', () => {
  assert.equal(formatDate(lastBackupAt, 'iso'), lastBackupAt);
  assert.equal(formatDate(lastBackupAt, 'iso_local'), '2026-08-20 15:08');
  assert.equal(formatDate(lastBackupAt, 'european'), '20/08/2026 15:08');
  assert.equal(formatDate(lastBackupAt, 'us'), '08/20/2026 03:08 PM');
});

test('formatDate pads hours and keeps midnight and noon readable in 12-hour format', () => {
  assert.equal(formatDate('2026-01-05T00:30:00.000Z', 'european'), '05/01/2026 01:30');
  assert.equal(formatDate('2026-01-05T22:05:00.000Z', 'us'), '01/05/2026 11:05 PM');
  assert.equal(formatDate('2026-01-05T11:00:00.000Z', 'us'), '01/05/2026 12:00 PM');
  assert.equal(formatDate('2026-01-05T23:00:00.000Z', 'us'), '01/06/2026 12:00 AM');
});

test('formatDate defaults to ISO 8601 and never invents a value', () => {
  assert.equal(formatDate(lastBackupAt), lastBackupAt);
  assert.equal(formatDate(lastBackupAt, 'unknown-format'), lastBackupAt);
  assert.equal(formatDate(undefined, 'european'), undefined);
  assert.equal(formatDate('', 'european'), undefined);
  // DSM sometimes reports a label instead of a date: it is published as-is.
  assert.equal(formatDate('never', 'european'), 'never');
});
