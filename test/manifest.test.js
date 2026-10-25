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
  wakeNas,
} from '../src/scene-actions.js';
import { SCENE_TRIGGER, SceneEventTracker } from '../src/scene-events.js';
import { BACKUP_FILTER } from '../src/widgets/backups.js';
import { WIDGET } from '../src/widgets/index.js';
import { DEFAULT_CHART_INTERVAL } from '../src/widgets/overview.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createFleet, dsmNetwork, rawDsmSnapshot } from './helpers/fleet.js';

// Every text a user reads is offered in the four languages of the Gladys interface.
const LANGUAGES = ['en', 'fr', 'de', 'es'];

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
    fields.date_format.options.every((option) =>
      LANGUAGES.every((language) => option.label[language]),
    ),
    'every date format option is translated',
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
  // The pin is optional and not secret: a certificate fingerprint is public by nature.
  for (const key of [
    'cert_fingerprint',
    'nas_2_cert_fingerprint',
    'nas_3_cert_fingerprint',
    'nas_4_cert_fingerprint',
  ]) {
    assert.equal(fields[key]?.type, 'string', key);
    assert.equal(fields[key].required, false, key);
    assert.equal(DEFAULT_CONFIG[key], '', key);
  }
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

  for (const language of LANGUAGES) {
    const documentation = await readFile(
      new URL(`../docs/${language}.md`, import.meta.url),
      'utf8',
    );
    assert.ok(documentation.length >= 300, `${language} documentation is too short`);
  }
});

test('manifest requires Gladys 5.3 and the SDK that brings its manifest fields', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  // An older core rejects the whole manifest over a field it does not know: categories need
  // 4.86, widgets and scenes 5.1, keywords / countries / music 5.3.
  assert.equal(manifest.gladys_version, '>=5.3.0');
  assert.ok(manifest.keywords || manifest.countries || manifest.music);
  assert.match(pkg.dependencies['@gladysassistant/integration-sdk'], /^\^0\.(1[6-9]|[2-9]\d)\./);
});

// The store's controlled vocabulary of catalog shelves (Gladys 5.3 added the last four). An
// unknown key is not rejected, it is DROPPED with a warning: a typo silently costs the shelf.
const CATALOG_CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

test('manifest catalog placement follows the store rules', () => {
  assert.deepEqual(manifest.categories, ['servers', 'network']);
  for (const category of manifest.categories) assert.ok(CATALOG_CATEGORIES.includes(category));
  // 1 to 10 search-only terms of 2 to 30 characters, unique once trimmed and lowercased.
  const keywords = manifest.keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.ok(keywords.length >= 1 && keywords.length <= 10);
  assert.equal(new Set(keywords).size, keywords.length, 'keywords must be unique');
  for (const keyword of keywords) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, `keyword "${keyword}"`);
  }
  // A Synology NAS sits anywhere: `countries` would hide the integration from other countries.
  assert.equal(manifest.countries, undefined);
});

test('manifest asks for Wake-on-LAN exactly when a scene action uses it', () => {
  // An undeclared wake is a 403 from the core; a declared one is shown on the install screen.
  assert.equal(manifest.network_wake, true);
  assert.ok(manifest.scene_actions.some((action) => action.key === SCENE_ACTION.WAKE_NAS));
});

function assertTranslated(text, path) {
  assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), `${path} languages`);
  for (const language of LANGUAGES) {
    assert.ok(typeof text[language] === 'string' && text[language].trim(), `${path}.${language}`);
  }
}

function assertBilingual(entry, path) {
  for (const key of ['label', 'description']) {
    if (entry[key] === undefined) continue;
    assertTranslated(entry[key], `${path}.${key}`);
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

// Every multi-language object of the manifest, wherever it sits.
function multiLanguageTexts(node, path = '', found = []) {
  if (Array.isArray(node)) {
    node.forEach((child, index) => multiLanguageTexts(child, `${path}[${index}]`, found));
  } else if (node && typeof node === 'object') {
    if (typeof node.en === 'string') found.push({ path, text: node });
    else {
      for (const [key, child] of Object.entries(node)) {
        multiLanguageTexts(child, `${path}.${key}`, found);
      }
    }
  }
  return found;
}

function assertLengths(text, path, min, max) {
  for (const language of LANGUAGES) {
    const { length } = text[language];
    assert.ok(length >= min && length <= max, `${path}.${language}: ${length} characters`);
  }
}

test('every manifest text is offered in English, French, German and Spanish', () => {
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 100);
  for (const { path, text } of texts) assertTranslated(text, path);
});

test('manifest texts respect the store length limits in every language', () => {
  assertLengths(manifest.description, 'description', 10, 100);
  for (const field of manifest.config_schema.filter((entry) => entry.type === 'section')) {
    for (const key of ['label', 'description']) {
      if (field[key]) assertLengths(field[key], `${field.key}.${key}`, 1, 1000);
    }
  }
  for (const widget of manifest.widgets) {
    assertLengths(widget.label, `${widget.key}.label`, 3, 30);
    if (widget.description) assertLengths(widget.description, `${widget.key}.description`, 1, 100);
  }
});

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
  const fleet = createFleet([[rawDsmSnapshot({ network: dsmNetwork() })]]);
  await fleet.refresh();
  const fields = {
    [SCENE_ACTION.NAS_STATUS]: {},
    [SCENE_ACTION.VOLUME_STATUS]: { device: 'synology-volume:ABC123:volume_1' },
    [SCENE_ACTION.BACKUP_STATUS]: { device: 'synology-backup:ABC123:hyper-backup:7' },
    [SCENE_ACTION.WAKE_NAS]: { device: 'synology-nas:ABC123' },
  };
  const handlers = {
    [SCENE_ACTION.NAS_STATUS]: getNasStatus,
    [SCENE_ACTION.VOLUME_STATUS]: getVolumeStatus,
    [SCENE_ACTION.BACKUP_STATUS]: getBackupStatus,
    [SCENE_ACTION.WAKE_NAS]: wakeNas,
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
