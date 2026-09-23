import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { buildWidgetContent, WIDGET } from '../src/widgets/index.js';
import { formatSize } from '../src/widgets/format.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createFleet, rawDsmSnapshot } from './helpers/fleet.js';

const POLL = 900;

async function readyFleet(readingsPerNas = [[rawDsmSnapshot()]]) {
  const fleet = createFleet(readingsPerNas);
  await fleet.refresh();
  return fleet;
}

function content(key, fleet, { gladys = createFakeGladys(), settings = {}, units } = {}) {
  return buildWidgetContent(key, { gladys, fleet, settings, units, pollFrequency: POLL });
}

function ofType(result, type) {
  return result.components.filter((component) => component.type === type);
}

test('every widget renders exactly as sent, within the content budget', async () => {
  const fleet = await readyFleet();
  const gladys = createFakeGladys();
  gladys.devices = [{ external_id: 'synology-nas:ABC123' }];
  for (const key of Object.values(WIDGET)) {
    for (const units of ['metric', 'us']) {
      assert.deepEqual(validateWidgetContent(content(key, fleet, { gladys, units })), [], key);
    }
  }
});

test('the NAS card shows the load, one row per volume and the disk and backup summaries', async () => {
  const fleet = await readyFleet();
  const result = content(WIDGET.OVERVIEW, fleet);

  assert.equal(result.ttl_seconds, POLL);
  assert.equal(ofType(result, 'text')[0].text, 'DS920+');
  assert.deepEqual(
    ofType(result, 'value').map((tile) => [tile.value, tile.unit]),
    [
      [12, '%'],
      [41, '%'],
      [48, '°C'],
    ],
  );
  const [status] = ofType(result, 'status');
  assert.deepEqual(
    status.items.map((item) => [item.value, item.color]),
    [
      ['95 %', 'danger'],
      ['? · crashed', 'danger'],
      [{ en: '1/2 healthy', fr: '1/2 sains' }, 'danger'],
      [{ en: '1 OK, 1 failed', fr: '1 OK, 1 en échec' }, 'danger'],
    ],
  );
  assert.deepEqual(ofType(result, 'button')[0].link, { url: 'https://nas-1:5001' });
  // No history chart until the NAS device exists in Gladys.
  assert.deepEqual(ofType(result, 'chart'), []);
});

test('the NAS card plots the load history once the NAS device is created', async () => {
  const fleet = await readyFleet();
  const gladys = createFakeGladys();
  gladys.devices = [{ external_id: 'synology-nas:ABC123' }];
  const [chart] = ofType(
    content(WIDGET.OVERVIEW, fleet, { gladys, settings: { chart_interval: 'last-week' } }),
    'chart',
  );
  assert.deepEqual(chart.device_features, [
    'synology-nas:ABC123:cpu-usage',
    'synology-nas:ABC123:memory-usage',
  ]);
  assert.equal(chart.interval, 'last-week');
});

test('a dashboard in US units reads Fahrenheit', async () => {
  const fleet = await readyFleet();
  const temperature = ofType(content(WIDGET.OVERVIEW, fleet, { units: 'us' }), 'value')[2];
  assert.deepEqual([temperature.value, temperature.unit], [118, '°F']);
});

test('the storage card shows a gauge per volume and the SMART state of each disk', async () => {
  const fleet = await readyFleet();
  const result = content(WIDGET.STORAGE, fleet);
  assert.deepEqual(ofType(result, 'text')[1].text, {
    en: '204.8 GB free of 4 TB',
    fr: '204,8 Go libres sur 4 To',
  });
  assert.deepEqual(
    ofType(result, 'gauge').map((gauge) => [gauge.label, gauge.value, gauge.color]),
    [['Volume 1', 95, 'danger']],
  );
  assert.deepEqual(
    ofType(result, 'status')[0].items.map((item) => [item.label, item.value, item.color]),
    [
      ['Drive 1', 'normal · 34 °C', 'success'],
      ['Drive 2', 'failing · 58 °C', 'danger'],
    ],
  );
});

test('the backups card lists failures first and can hide the successful tasks', async () => {
  const fleet = await readyFleet();
  const result = content(WIDGET.BACKUPS, fleet);
  assert.deepEqual(
    ofType(result, 'value').map((tile) => tile.value),
    [1, 1],
  );
  const [list] = ofType(result, 'card-list');
  assert.deepEqual(
    list.items.map((item) => [item.title, item.badge.color, item.subtitle]),
    [
      ['USB copy', 'danger', 'Hyper Backup · DS920+'],
      ['Cloud archive', 'success', 'Hyper Backup · DS920+'],
    ],
  );
  assert.equal(list.items[1].date, '2026-09-21T14:13:20.000Z');

  const problems = content(WIDGET.BACKUPS, fleet, { settings: { tasks: 'problems' } });
  assert.deepEqual(
    ofType(problems, 'card-list')[0].items.map((item) => item.title),
    ['USB copy'],
  );
});

test('the backups card covers every NAS unless one is chosen, and names the unreachable ones', async () => {
  const fleet = await readyFleet([
    [rawDsmSnapshot()],
    [rawDsmSnapshot({ serial: 'XYZ', model: 'DS224+' }), new Error('ETIMEDOUT')],
  ]);
  await fleet.refresh();

  const all = content(WIDGET.BACKUPS, fleet);
  assert.equal(ofType(all, 'card-list')[0].items.length, 4);
  assert.deepEqual(ofType(all, 'status')[0].items[0].label, 'DS224+');

  const one = content(WIDGET.BACKUPS, fleet, {
    settings: { nas: 'synology-backup:ABC123:hyper-backup:7' },
  });
  assert.equal(ofType(one, 'card-list')[0].items.length, 2);
  assert.deepEqual(ofType(one, 'status'), []);
});

test('any device of a NAS selects that NAS', async () => {
  const fleet = await readyFleet([
    [rawDsmSnapshot()],
    [rawDsmSnapshot({ serial: 'XYZ', model: 'DS224+' })],
  ]);
  for (const nas of [
    'synology-nas:XYZ',
    'synology-volume:XYZ:volume_1',
    'synology-disk:XYZ:sata2',
  ]) {
    assert.equal(
      ofType(content(WIDGET.OVERVIEW, fleet, { settings: { nas } }), 'text')[0].text,
      'DS224+',
    );
  }
  assert.equal(ofType(content(WIDGET.OVERVIEW, fleet), 'text')[0].text, 'DS920+');
});

test('widgets explain what is missing instead of failing', async () => {
  const notConnected = content(WIDGET.OVERVIEW, null);
  assert.match(notConnected.components[0].text.en, /not connected/);

  const fleet = await readyFleet();
  const unknown = content(WIDGET.STORAGE, fleet, { settings: { nas: 'synology-nas:GONE' } });
  assert.match(unknown.components[0].text.en, /no longer known/);

  const neverReached = createFleet([[new Error('ECONNREFUSED')]]);
  await assert.rejects(neverReached.refresh());
  const waiting = content(WIDGET.OVERVIEW, neverReached);
  assert.match(waiting.components[0].text.en, /first reading/);
  assert.equal(ofType(waiting, 'status')[0].items[0].color, 'danger');

  for (const result of [notConnected, unknown, waiting]) {
    assert.deepEqual(validateWidgetContent(result), []);
  }
});

test('sizes are short and localized', () => {
  assert.deepEqual(formatSize(1.5 * 1024 ** 4), { en: '1.5 TB', fr: '1,5 To' });
  assert.deepEqual(formatSize(512 * 1024 ** 2), { en: '512 MB', fr: '512 Mo' });
});
