import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ActorType,
  ApplicationError,
  ErrorCode,
  FixedClock,
  PassthroughTransactionRunner,
  RequestContextStore,
  createUuidV7,
  isUuidV7,
} from './index';

test('createUuidV7 encodes the timestamp, version and variant', () => {
  const timestamp = 1_725_000_000_123;
  const uuid = createUuidV7(timestamp);
  const compact = uuid.replaceAll('-', '');

  assert.equal(isUuidV7(uuid), true);
  assert.equal(Number.parseInt(compact.slice(0, 12), 16), timestamp);
  assert.equal(uuid[14], '7');
  assert.match(uuid[19] ?? '', /^[89ab]$/);
});

test('RequestContextStore preserves context across asynchronous work and restores parents', async () => {
  const store = new RequestContextStore();

  await store.run(
    {
      requestId: 'request-parent',
      traceId: 'trace-parent',
      actorType: ActorType.ADMIN,
      actorId: 'admin-1',
    },
    async () => {
      await Promise.resolve();
      assert.equal(store.require().requestId, 'request-parent');

      store.run(
        {
          requestId: 'request-child',
          traceId: 'trace-parent',
          actorType: ActorType.SYSTEM,
        },
        () => {
          assert.equal(store.require().requestId, 'request-child');
        },
      );

      assert.equal(store.require().requestId, 'request-parent');
    },
  );

  assert.equal(store.get(), undefined);
});

test('RequestContextStore.require fails with a stable error code outside a context', () => {
  const store = new RequestContextStore();

  assert.throws(
    () => store.require(),
    (error: unknown) => {
      assert.equal(error instanceof ApplicationError, true);
      assert.equal((error as ApplicationError).code, ErrorCode.REQUEST_CONTEXT_REQUIRED);
      return true;
    },
  );
});

test('FixedClock returns defensive Date values and can be advanced', () => {
  const clock = new FixedClock('2026-08-29T10:00:00.000Z');
  const first = clock.now();

  first.setUTCFullYear(2000);
  assert.equal(clock.now().toISOString(), '2026-08-29T10:00:00.000Z');

  clock.advanceBy(1_000);
  assert.equal(clock.now().toISOString(), '2026-08-29T10:00:01.000Z');
});

test('PassthroughTransactionRunner executes a transaction work function', async () => {
  const transactionRunner = new PassthroughTransactionRunner();
  const result = await transactionRunner.run(async () => 'completed');

  assert.equal(result, 'completed');
});
