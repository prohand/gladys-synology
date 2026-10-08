import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeConfig } from '../src/config.js';
import { SynologyService } from '../src/service.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

function rawSnapshot() {
  return {
    system: { serial: 'ABC123', model: 'DS920+', firmware_ver: 'DSM 7.2.2' },
    utilization: {
      cpu: { total_load: 10 },
      memory: { real_usage: 20 },
      network: [{ rx: 30, tx: 40 }],
    },
    storage: { volumes: [] },
  };
}

test('service coalesces concurrent DSM refreshes', async () => {
  let requests = 0;
  const client = {
    async getSnapshot() {
      requests += 1;
      await Promise.resolve();
      return rawSnapshot();
    },
    async close() {},
  };
  const service = new SynologyService(
    normalizeConfig({ url: 'https://nas', username: 'u', password: 'p' }),
    { clientFactory: () => client },
  );

  const [first, second] = await Promise.all([service.refresh(), service.refresh()]);
  assert.equal(first, second);
  assert.equal(requests, 1);
  assert.equal(service.nasId, 'ABC123');
});

test('service publishes a normalized state batch', async () => {
  const gladys = createFakeGladys();
  const service = new SynologyService(
    normalizeConfig({ url: 'https://nas', username: 'u', password: 'p' }),
    {
      clientFactory: () => ({
        async getSnapshot() {
          return rawSnapshot();
        },
        async close() {},
      }),
    },
  );

  await service.publishStates(gladys);
  assert.ok(gladys.published.length > 0);
  assert.ok(
    gladys.published.every(({ device_feature_external_id }) =>
      device_feature_external_id.startsWith('synology-nas:ABC123:'),
    ),
  );
});

test('service throttles scheduled publications and allows a forced refresh', async () => {
  let now = 1_000;
  const gladys = createFakeGladys();
  const service = new SynologyService(
    normalizeConfig({
      url: 'https://nas',
      username: 'u',
      password: 'p',
      poll_frequency: 300,
    }),
    {
      now: () => now,
      clientFactory: () => ({
        async getSnapshot() {
          return rawSnapshot();
        },
        async close() {},
      }),
    },
  );

  await service.publishStates(gladys);
  const firstBatchSize = gladys.published.length;
  now += 60_000;
  await service.publishStates(gladys);
  assert.equal(gladys.published.length, firstBatchSize);

  await service.publishStates(gladys, { force: true });
  assert.equal(gladys.published.length, firstBatchSize * 2);
});

test('a refresh timer firing a few milliseconds early still publishes', async () => {
  let now = 1_000_000;
  let snapshots = 0;
  const service = new SynologyService(
    normalizeConfig({
      url: 'https://nas',
      username: 'u',
      password: 'p',
      poll_frequency: 900,
    }),
    {
      clientFactory: () => ({
        async getSnapshot() {
          snapshots += 1;
          return rawSnapshot();
        },
        async close() {},
      }),
      now: () => now,
    },
  );
  const gladys = createFakeGladys();

  await service.publishStates(gladys);
  now += 900 * 1000 - 5;
  await service.publishStates(gladys);
  assert.equal(snapshots, 2);

  // Well inside the interval, the throttle still protects the Gladys database.
  now += 60 * 1000;
  await service.publishStates(gladys);
  assert.equal(snapshots, 2);
});

test('service splits a large NAS into batches the host API accepts', async () => {
  const gladys = createFakeGladys();
  const disks = Array.from({ length: 40 }, (_, index) => ({
    id: `disk_${index + 1}`,
    name: `Drive ${index + 1}`,
    smart_status: 'normal',
    temp: 35,
  }));
  const service = new SynologyService(
    normalizeConfig({ url: 'https://nas', username: 'u', password: 'p' }),
    {
      clientFactory: () => ({
        async getSnapshot() {
          return { ...rawSnapshot(), storage: { volumes: [], disks } };
        },
        async close() {},
      }),
    },
  );

  await service.publishStates(gladys);
  assert.ok(gladys.published.length > 100);
});

test('service replays a recent snapshot instead of reading DSM again', async () => {
  let now = 1_000;
  let requests = 0;
  const gladys = createFakeGladys();
  const service = new SynologyService(
    normalizeConfig({ url: 'https://nas', username: 'u', password: 'p' }),
    {
      now: () => now,
      clientFactory: () => ({
        async getSnapshot() {
          requests += 1;
          return rawSnapshot();
        },
        async close() {},
      }),
    },
  );

  await service.publishStates(gladys);
  const perPublication = gladys.published.length;
  const events = gladys.sceneEvents.length;

  // Devices added one after the other from the Discovery screen.
  now += 5_000;
  await service.publishStates(gladys, { force: true, maxSnapshotAgeMs: 30_000 });
  now += 5_000;
  await service.publishStates(gladys, { force: true, maxSnapshotAgeMs: 30_000 });
  assert.equal(requests, 1, 'the snapshot read 10 s ago is reused');
  assert.equal(gladys.published.length, 3 * perPublication);
  assert.equal(gladys.sceneEvents.length, events, 'a replay reads nothing new, so fires nothing');

  now += 30_000;
  await service.publishStates(gladys, { force: true, maxSnapshotAgeMs: 30_000 });
  assert.equal(requests, 2, 'an older snapshot is read again');
});
