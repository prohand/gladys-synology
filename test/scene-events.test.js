import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeConfig } from '../src/config.js';
import { SCENE_TRIGGER, SceneEventTracker } from '../src/scene-events.js';
import { SynologyService } from '../src/service.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const CONTEXT = { nasId: 'ABC123', url: 'https://nas:5001', dateFormat: 'iso' };

function snapshot({ volumes = [], disks = [], backups = [], dsmVersion = 'DSM 7.2.2' } = {}) {
  return {
    nas: { serial: 'ABC123', model: 'DS920+', dsmVersion },
    volumes,
    disks,
    backups,
  };
}

function volume(healthy, status) {
  return { id: 'volume_1', name: 'Volume 1', status, healthy, usagePercent: 42.5 };
}

function backup(overrides = {}) {
  return {
    id: '7',
    provider: 'hyper-backup',
    name: 'Cloud archive',
    status: 'backupable',
    result: 'done',
    outcome: 'success',
    lastBackupAt: '2026-09-20T01:00:00.000Z',
    ...overrides,
  };
}

function assertFlat(events) {
  for (const { data } of events) {
    for (const value of Object.values(data)) {
      assert.ok(
        value === null || ['string', 'number', 'boolean'].includes(typeof value),
        `event data must stay flat, got ${value}`,
      );
    }
  }
}

test('the first reading is only a reference, even with failures already present', () => {
  const tracker = new SceneEventTracker();
  const gladys = createFakeGladys();
  const events = tracker.observe(
    gladys,
    CONTEXT,
    snapshot({
      volumes: [volume(0, 'crashed')],
      disks: [{ id: 'disk_1', name: 'Drive 1', smartStatus: 'failing', smartHealthy: 0 }],
      backups: [backup({ result: 'failed', outcome: 'failure' })],
    }),
  );
  assert.deepEqual(events, []);
});

test('a degraded volume fires once, a maintenance state in between keeps the last verdict', () => {
  const tracker = new SceneEventTracker();
  const gladys = createFakeGladys();
  tracker.observe(gladys, CONTEXT, snapshot({ volumes: [volume(1, 'normal')] }));
  assert.deepEqual(
    tracker.observe(gladys, CONTEXT, snapshot({ volumes: [volume(undefined, 'expanding')] })),
    [],
  );

  const events = tracker.observe(gladys, CONTEXT, snapshot({ volumes: [volume(0, 'crashed')] }));
  assert.deepEqual(events, [
    {
      key: SCENE_TRIGGER.VOLUME_UNHEALTHY,
      data: {
        device: 'synology-volume:ABC123:volume_1',
        nas_name: 'DS920+',
        volume_name: 'Volume 1',
        status: 'crashed',
        usage_percent: 42.5,
      },
    },
  ]);
  assert.deepEqual(
    tracker.observe(gladys, CONTEXT, snapshot({ volumes: [volume(0, 'crashed')] })),
    [],
  );
});

test('a failing disk fires with its SMART details', () => {
  const tracker = new SceneEventTracker();
  const gladys = createFakeGladys();
  const disk = { id: 'sata1', name: 'Drive 1', smartStatus: 'normal', smartHealthy: 1 };
  tracker.observe(gladys, CONTEXT, snapshot({ disks: [disk] }));
  const events = tracker.observe(
    gladys,
    CONTEXT,
    snapshot({ disks: [{ ...disk, smartStatus: 'failing', smartHealthy: 0 }] }),
  );
  assert.deepEqual(events, [
    {
      key: SCENE_TRIGGER.DISK_UNHEALTHY,
      data: {
        device: 'synology-disk:ABC123:sata1',
        nas_name: 'DS920+',
        disk_name: 'Drive 1',
        smart_status: 'failing',
        temperature: null,
      },
    },
  ]);
  assertFlat(events);
});

test('a backup run fires once when it finishes, never while it is running', () => {
  const tracker = new SceneEventTracker();
  const gladys = createFakeGladys();
  tracker.observe(gladys, CONTEXT, snapshot({ backups: [backup()] }));
  assert.deepEqual(tracker.observe(gladys, CONTEXT, snapshot({ backups: [backup()] })), []);
  assert.deepEqual(
    tracker.observe(
      gladys,
      CONTEXT,
      snapshot({ backups: [backup({ result: 'backingup', outcome: undefined })] }),
    ),
    [],
  );

  const failed = backup({
    result: 'failed',
    outcome: 'failure',
    lastBackupAt: '2026-09-21T01:00:00.000Z',
  });
  const events = tracker.observe(
    gladys,
    { ...CONTEXT, dateFormat: 'iso_local' },
    snapshot({ backups: [failed] }),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].key, SCENE_TRIGGER.BACKUP_FINISHED);
  assert.deepEqual(
    { ...events[0].data, last_backup: typeof events[0].data.last_backup },
    {
      device: 'synology-backup:ABC123:hyper-backup:7',
      provider: 'hyper-backup',
      outcome: 'failure',
      nas_name: 'DS920+',
      task_name: 'Cloud archive',
      provider_name: 'Hyper Backup',
      result: 'failed',
      last_backup: 'string',
    },
  );
  assert.match(events[0].data.last_backup, /^2026-09-2\d \d\d:\d\d$/);
  assertFlat(events);
  assert.deepEqual(tracker.observe(gladys, CONTEXT, snapshot({ backups: [failed] })), []);
});

test('a backup already running at startup fires when it finishes', () => {
  const tracker = new SceneEventTracker();
  const gladys = createFakeGladys();
  const running = backup({ result: 'backingup', outcome: undefined });
  tracker.observe(gladys, CONTEXT, snapshot({ backups: [running] }));
  assert.deepEqual(tracker.observe(gladys, CONTEXT, snapshot({ backups: [running] })), []);
  assert.deepEqual(
    tracker
      .observe(gladys, CONTEXT, snapshot({ backups: [backup()] }))
      .map((event) => event.data.outcome),
    ['success'],
  );
});

test('a new DSM version fires with the previous one', () => {
  const tracker = new SceneEventTracker();
  const gladys = createFakeGladys();
  tracker.observe(gladys, CONTEXT, snapshot({ dsmVersion: 'DSM 7.2.1' }));
  assert.deepEqual(tracker.observe(gladys, CONTEXT, snapshot({ dsmVersion: '' })), []);
  assert.deepEqual(tracker.observe(gladys, CONTEXT, snapshot({ dsmVersion: 'DSM 7.2.2' })), [
    {
      key: SCENE_TRIGGER.DSM_UPDATED,
      data: {
        device: 'synology-nas:ABC123',
        nas_name: 'DS920+',
        previous_version: 'DSM 7.2.1',
        version: 'DSM 7.2.2',
      },
    },
  ]);
});

test('a NAS that stops answering fires once, then again when it is back', () => {
  let now = 0;
  const tracker = new SceneEventTracker({ now: () => now });
  const gladys = createFakeGladys();
  const reading = snapshot();

  assert.deepEqual(tracker.observeFailure(gladys, CONTEXT, null, new Error('boot')), []);
  assert.deepEqual(tracker.observe(gladys, CONTEXT, reading), []);

  const down = tracker.observeFailure(gladys, CONTEXT, reading, new Error('ETIMEDOUT'));
  assert.deepEqual(down, [
    {
      key: SCENE_TRIGGER.NAS_UNREACHABLE,
      data: {
        device: 'synology-nas:ABC123',
        nas_name: 'DS920+',
        url: 'https://nas:5001',
        error: 'ETIMEDOUT',
      },
    },
  ]);
  assert.deepEqual(tracker.observeFailure(gladys, CONTEXT, reading, new Error('again')), []);

  now = 30 * 60_000;
  assert.deepEqual(tracker.observe(gladys, CONTEXT, reading), [
    {
      key: SCENE_TRIGGER.NAS_REACHABLE,
      data: {
        device: 'synology-nas:ABC123',
        nas_name: 'DS920+',
        url: 'https://nas:5001',
        offline_minutes: 30,
      },
    },
  ]);
});

function createService(readings) {
  let index = 0;
  return new SynologyService(
    normalizeConfig({ url: 'https://nas', username: 'u', password: 'p', poll_frequency: 60 }),
    {
      clientFactory: () => ({
        async getSnapshot() {
          const reading = readings[Math.min(index, readings.length - 1)];
          index += 1;
          if (reading instanceof Error) throw reading;
          return reading;
        },
        async close() {},
      }),
    },
  );
}

const RAW_NAS = { system: { serial: 'ABC123', model: 'DS920+', firmware_ver: 'DSM 7.2.2' } };

test('the monitoring loop publishes the events, a manual refresh never does', async () => {
  const gladys = createFakeGladys();
  const service = createService([RAW_NAS, new Error('ECONNREFUSED'), RAW_NAS]);

  await service.publishStates(gladys, { force: true });
  await assert.rejects(service.publishStates(gladys, { force: true }), /ECONNREFUSED/);
  assert.deepEqual(
    gladys.sceneEvents.map((event) => event.key),
    [SCENE_TRIGGER.NAS_UNREACHABLE],
  );
  assert.equal(service.lastError.message, 'ECONNREFUSED');

  // A refresh asked by a scene action updates the snapshot without firing any event.
  await service.refresh();
  assert.equal(service.lastError, null);
  assert.equal(gladys.sceneEvents.length, 1);

  await service.publishStates(gladys, { force: true });
  assert.deepEqual(
    gladys.sceneEvents.map((event) => event.key),
    [SCENE_TRIGGER.NAS_UNREACHABLE, SCENE_TRIGGER.NAS_REACHABLE],
  );
});

test('a refused scene event never breaks the state publication', async () => {
  const gladys = createFakeGladys();
  gladys.publishSceneEvent = async () => {
    throw new Error('429 Too Many Requests');
  };
  const service = createService([RAW_NAS, new Error('down'), RAW_NAS]);
  await service.publishStates(gladys, { force: true });
  await assert.rejects(service.publishStates(gladys, { force: true }), /down/);
  await service.publishStates(gladys, { force: true });
  assert.ok(gladys.published.length > 0);
});
