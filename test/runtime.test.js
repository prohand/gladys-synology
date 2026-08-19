import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigValidationError } from '../src/config.js';
import { createRuntime } from '../src/runtime.js';
import { createFakeGladysIntegration, createFakeScheduler } from './helpers/fakeGladys.js';

const VALID_CONFIG = { url: 'https://nas', username: 'gladys', password: 'password' };

function createFakeFleet({
  failures = [],
  devices = [{ external_id: 'synology-nas:ABC123' }],
} = {}) {
  return {
    lastFailures: failures,
    closed: 0,
    published: 0,
    async discover() {
      return devices;
    },
    async publishStates() {
      this.published += 1;
    },
    async refresh() {
      return [];
    },
    async close() {
      this.closed += 1;
    },
  };
}

function createRuntimeUnderTest(overrides = {}) {
  const gladys = createFakeGladysIntegration({ config: VALID_CONFIG });
  const scheduler = createFakeScheduler();
  const runtime = createRuntime(gladys, {
    scheduler,
    backoff: { next: () => 1000, reset: () => {} },
    ...overrides,
  });
  return { gladys, scheduler, runtime };
}

test('a rejected configuration is reported to Gladys and is not retried', async () => {
  const { gladys, scheduler, runtime } = createRuntimeUnderTest({
    serviceFactory: () => {
      throw new ConfigValidationError('The Synology DSM URL is required.');
    },
  });

  await assert.rejects(runtime.initialize({}), ConfigValidationError);
  assert.deepEqual(gladys.statuses, [
    {
      connected: false,
      message: {
        en: 'Unable to monitor Synology DSM: The Synology DSM URL is required.',
        fr: 'Impossible de superviser Synology DSM : The Synology DSM URL is required.',
      },
    },
  ]);
  assert.equal(scheduler.timeouts.length, 0, 'a configuration error must not schedule a retry');
  await assert.rejects(runtime.ready(), /not connected yet/);
});

test('a replaced configuration closes the previous connection, even when the new one is invalid', async () => {
  const fleet = createFakeFleet();
  let first = true;
  const { runtime } = createRuntimeUnderTest({
    serviceFactory: () => {
      if (first) {
        first = false;
        return fleet;
      }
      throw new ConfigValidationError('The Synology DSM URL is invalid.');
    },
  });

  await runtime.initialize(VALID_CONFIG);
  await assert.rejects(runtime.initialize({ url: 'nope://nas' }), ConfigValidationError);
  assert.equal(fleet.closed, 1);
  assert.equal(runtime.getService(), null);
});

test('an unreachable NAS schedules a retry and stops the refresh timer', async () => {
  const { gladys, scheduler, runtime } = createRuntimeUnderTest({
    serviceFactory: () => ({
      lastFailures: [],
      async discover() {
        throw new Error('Unable to reach Synology DSM');
      },
      async close() {},
    }),
  });

  await assert.rejects(runtime.initialize(VALID_CONFIG), /Unable to reach Synology DSM/);
  assert.deepEqual(gladys.statuses.at(-1).connected, false);
  assert.equal(scheduler.timeouts.length, 1);
  assert.equal(scheduler.intervals.length, 0);
});

test('a healthy fleet reports a connected status and refreshes on the configured interval', async () => {
  const fleet = createFakeFleet();
  const { gladys, scheduler, runtime } = createRuntimeUnderTest({ serviceFactory: () => fleet });

  await runtime.initialize({ ...VALID_CONFIG, poll_frequency: 120 });

  assert.deepEqual(gladys.statuses, [{ connected: true, message: undefined }]);
  assert.equal(gladys.discovered.length, 1);
  assert.equal(scheduler.intervals.length, 1);
  assert.equal(scheduler.intervals[0].delay, 120_000);

  await scheduler.intervals[0].callback();
  assert.equal(fleet.published, 2);
});

test('a partially unreachable fleet stays connected and names the failing NAS', async () => {
  const failures = [{ url: 'https://nas2', error: new Error('Unable to reach Synology DSM') }];
  const { gladys, runtime } = createRuntimeUnderTest({
    serviceFactory: () => createFakeFleet({ failures }),
  });

  await runtime.initialize(VALID_CONFIG);

  assert.deepEqual(gladys.statuses, [
    {
      connected: true,
      message: {
        en: '1 Synology NAS unreachable: https://nas2 (Unable to reach Synology DSM)',
        fr: '1 NAS Synology injoignable(s) : https://nas2 (Unable to reach Synology DSM)',
      },
    },
  ]);
});

test('handlers wait for the initialization and survive a failed startup', async () => {
  let attempt = 0;
  const fleet = createFakeFleet();
  const { gladys, runtime } = createRuntimeUnderTest({
    serviceFactory: () => {
      attempt += 1;
      if (attempt === 1) throw new ConfigValidationError('The Synology DSM URL is required.');
      return fleet;
    },
  });

  gladys.emit('connected');
  await assert.rejects(runtime.ready(), /not connected yet/);

  await gladys.handlers.configUpdated(VALID_CONFIG);
  await gladys.handlers.poll();
  await gladys.handlers.deviceCreated();
  await gladys.handlers.scan();

  assert.equal(runtime.getService(), fleet);
  assert.equal(gladys.discovered.length, 2);
});

test('shutdown clears the timers and closes the fleet', async () => {
  const fleet = createFakeFleet();
  const { gladys, scheduler, runtime } = createRuntimeUnderTest({ serviceFactory: () => fleet });

  await runtime.initialize(VALID_CONFIG);
  await gladys.handlers.shutdown('SIGTERM');

  assert.equal(fleet.closed, 1);
  assert.ok(scheduler.intervals.every((timer) => timer.cleared));
});

test('the connection test reports both reachable and unreachable NAS', async () => {
  const failures = [{ url: 'https://nas2', error: new Error('Unable to reach Synology DSM') }];
  const fleet = {
    ...createFakeFleet({ failures }),
    async refresh() {
      return [
        {
          nas: { model: 'DS920+', dsmVersion: 'DSM 7.2.2' },
          volumes: [{}],
          disks: [{}, {}],
          backups: [],
        },
      ];
    },
  };
  const { gladys, runtime } = createRuntimeUnderTest({ serviceFactory: () => fleet });

  await runtime.initialize(VALID_CONFIG);
  const message = await gladys.handlers['action:test_connection']();

  assert.match(message.en, /^1 NAS reachable: DS920\+ \(DSM 7\.2\.2, 1 volume\(s\), 2 disk\(s\)/);
  assert.match(message.en, /1 NAS unreachable: https:\/\/nas2\./);
  assert.match(message.fr, /1 NAS injoignable\(s\) : https:\/\/nas2\./);
});
