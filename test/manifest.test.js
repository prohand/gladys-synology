import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { DEFAULT_CONFIG, MAX_POLL_FREQUENCY, MIN_POLL_FREQUENCY } from '../src/config.js';
import { DATE_FORMATS } from '../src/date-format.js';
import { WIDGET_CHART_INTERVALS } from '@gladysassistant/integration-sdk';
import {
  getBackupStatus,
  getNasStatus,
  getVolumeStatus,
  SCENE_ACTION,
} from '../src/scene-actions.js';
import { SCENE_TRIGGER, SceneEventTracker } from '../src/scene-events.js';
import { BACKUP_FILTER } from '../src/widgets/backups.js';
import { WIDGET } from '../src/widgets/index.js';
import { DEFAULT_CHART_INTERVAL } from '../src/widgets/overview.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createFleet, rawDsmSnapshot } from './helpers/fleet.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

test('manifest identifies a versioned Synology device integration', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'Synology DSM');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-synology:${manifest.version}`);
});

test('manifest configuration defaults stay in sync with code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((field) => [field.key, field]));
  assert.equal(fields.verify_ssl.default, DEFAULT_CONFIG.verify_ssl);
  assert.equal(Number(fields.poll_frequency.default), DEFAULT_CONFIG.poll_frequency);
  assert.equal(fields.poll_frequency.type, 'number');
  assert.equal(fields.poll_frequency.min, MIN_POLL_FREQUENCY);
  assert.equal(fields.poll_frequency.max, MAX_POLL_FREQUENCY);
  assert.equal(fields.poll_frequency.options, undefined);
  assert.equal(fields.date_format.type, 'select');
  assert.equal(fields.date_format.default, DEFAULT_CONFIG.date_format);
  assert.equal(fields.date_format.required, false);
  assert.deepEqual(
    fields.date_format.options.map((option) => option.value),
    DATE_FORMATS,
  );
  assert.ok(
    fields.date_format.options.every((option) => option.label.en && option.label.fr),
    'every date format option is bilingual',
  );
  assert.equal(fields.password.type, 'secret');
  assert.equal(fields.otp_code.type, 'secret');
  assert.equal(fields.additional_nas, undefined);
  for (const slot of [2, 3, 4]) {
    assert.equal(fields[`nas_${slot}_password`].type, 'secret');
    assert.equal(fields[`nas_${slot}_otp_code`].type, 'secret');
    assert.equal(fields[`nas_${slot}_url`].required, false);
    assert.equal(fields[`nas_${slot}_verify_ssl`].default, true);
  }
  assert.equal(fields.otp_code.required, false);
  for (const key of ['url', 'username', 'password']) assert.equal(fields[key].required, true);
});

test('manifest exposes local transport, documentation and connection test', () => {
  assert.deepEqual(manifest.transports, ['local']);
  assert.ok(manifest.config_schema.find((field) => field.type === 'section').links.length > 0);
  assert.ok(manifest.actions.some((action) => action.key === 'test_connection'));
});

test('catalog assets satisfy the store size and dimension constraints', async () => {
  const coverPath = new URL('../cover.png', import.meta.url);
  const cover = await readFile(coverPath);
  assert.equal(cover.toString('ascii', 1, 4), 'PNG');
  assert.equal(cover.readUInt32BE(16), 800);
  assert.equal(cover.readUInt32BE(20), 534);
  assert.ok((await stat(coverPath)).size <= 150_000);

  for (const language of ['en', 'fr']) {
    const documentation = await readFile(
      new URL(`../docs/${language}.md`, import.meta.url),
      'utf8',
    );
    assert.ok(documentation.length >= 300, `${language} documentation is too short`);
  }
});

test('manifest requires Gladys 5.1 and the SDK that brings widgets and scene declarations', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.gladys_version, '>=5.1.0');
  assert.match(pkg.dependencies['@gladysassistant/integration-sdk'], /^\^0\.(1[4-9]|[2-9]\d)\./);
});

function assertBilingual(entry, path) {
  for (const key of ['label', 'description']) {
    if (entry[key] === undefined) continue;
    assert.ok(entry[key].en && entry[key].fr, `${path}.${key} must be bilingual`);
  }
  for (const [index, child] of [
    ...(entry.fields ?? []),
    ...(entry.settings ?? []),
    ...(entry.variables ?? []),
    ...(entry.outputs ?? []),
    ...(entry.options ?? []),
  ].entries()) {
    assertBilingual(child, `${path}[${index}]`);
  }
}

test('manifest widgets stay in sync with code', () => {
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    Object.values(WIDGET),
  );
  assert.ok(manifest.widgets.length <= 5);
  for (const widget of manifest.widgets) {
    assertBilingual(widget, widget.key);
    assert.match(widget.icon, /^[a-z0-9-]{1,40}$/);
    const nas = widget.settings.find((setting) => setting.key === 'nas');
    assert.deepEqual([nas.type, nas.source, nas.required], ['select', 'devices', false]);
  }
  const settings = (key) =>
    Object.fromEntries(
      manifest.widgets.find((widget) => widget.key === key).settings.map((s) => [s.key, s]),
    );
  const interval = settings(WIDGET.OVERVIEW).chart_interval;
  assert.equal(interval.default, DEFAULT_CHART_INTERVAL);
  for (const option of interval.options) {
    assert.ok(Object.values(WIDGET_CHART_INTERVALS).includes(option.value), option.value);
  }
  const tasks = settings(WIDGET.BACKUPS).tasks;
  assert.deepEqual(
    tasks.options.map((option) => option.value),
    Object.values(BACKUP_FILTER),
  );
  assert.equal(tasks.default, BACKUP_FILTER.ALL);
});

// One reading of each kind of change, so every trigger publishes at least one event.
function everySceneEvent() {
  let now = 0;
  const tracker = new SceneEventTracker({ now: () => now });
  const gladys = createFakeGladys();
  const context = { nasId: 'ABC123', url: 'https://nas', dateFormat: 'iso' };
  const reading = (healthy, dsmVersion, backup) => ({
    nas: { model: 'DS920+', dsmVersion },
    volumes: [{ id: 'v1', name: 'Volume 1', status: 'x', healthy, usagePercent: 10 }],
    disks: [
      { id: 'd1', name: 'Drive 1', smartStatus: 'x', smartHealthy: healthy, temperature: 30 },
    ],
    backups: [{ id: '1', provider: 'hyper-backup', name: 'Task', result: 'done', ...backup }],
  });
  const events = [
    ...tracker.observe(gladys, context, reading(1, '7.2.1', { outcome: 'success' })),
    ...tracker.observeFailure(gladys, context, null, new Error('down')),
  ];
  now = 60_000;
  events.push(
    ...tracker.observe(
      gladys,
      context,
      reading(0, '7.2.2', { outcome: 'failure', result: 'failed', lastBackupAt: '2026-09-22' }),
    ),
  );
  return events;
}

test('manifest scene triggers declare every key their events carry', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key),
    Object.values(SCENE_TRIGGER),
  );
  const events = everySceneEvent();
  for (const trigger of manifest.scene_triggers) {
    assertBilingual(trigger, trigger.key);
    const event = events.find((candidate) => candidate.key === trigger.key);
    assert.ok(event, `no event published for ${trigger.key}`);
    const declared = [
      ...new Set([...trigger.fields, ...trigger.variables].map((entry) => entry.key)),
    ].sort();
    assert.deepEqual(Object.keys(event.data).sort(), declared, trigger.key);
    const device = trigger.fields.find((field) => field.key === 'device');
    assert.deepEqual([device.source, device.required], ['devices', false], trigger.key);
  }
});

test('manifest scene actions declare exactly the outputs their handlers return', async () => {
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key),
    Object.values(SCENE_ACTION),
  );
  const gladys = createFakeGladys();
  const fleet = createFleet([[rawDsmSnapshot()]]);
  await fleet.refresh();
  const fields = {
    [SCENE_ACTION.NAS_STATUS]: {},
    [SCENE_ACTION.VOLUME_STATUS]: { device: 'synology-volume:ABC123:volume_1' },
    [SCENE_ACTION.BACKUP_STATUS]: { device: 'synology-backup:ABC123:hyper-backup:7' },
  };
  const handlers = {
    [SCENE_ACTION.NAS_STATUS]: getNasStatus,
    [SCENE_ACTION.VOLUME_STATUS]: getVolumeStatus,
    [SCENE_ACTION.BACKUP_STATUS]: getBackupStatus,
  };
  for (const action of manifest.scene_actions) {
    assertBilingual(action, action.key);
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
    const outputs = await handlers[action.key](fleet, gladys, fields[action.key]);
    assert.deepEqual(
      Object.keys(outputs).sort(),
      action.outputs.map((output) => output.key).sort(),
      action.key,
    );
  }
});
