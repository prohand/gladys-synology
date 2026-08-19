import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBackoff } from '../src/backoff.js';

test('backoff grows exponentially and stops at the maximum delay', () => {
  const backoff = createBackoff({ initialDelay: 30_000, maxDelay: 120_000 });
  assert.deepEqual(
    [backoff.next(), backoff.next(), backoff.next(), backoff.next()],
    [30_000, 60_000, 120_000, 120_000],
  );
});

test('backoff restarts from the initial delay after a successful connection', () => {
  const backoff = createBackoff({ initialDelay: 30_000, maxDelay: 120_000 });
  backoff.next();
  backoff.next();
  backoff.reset();
  assert.equal(backoff.next(), 30_000);
});
