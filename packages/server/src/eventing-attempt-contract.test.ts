import assert from 'node:assert/strict';
import test from 'node:test';
import type { EntityManager } from 'typeorm';
import {
  finishConsumption,
  finishOutboxAttempt,
  finishWebhookExecution,
  lockConsumption,
  recoverWebhookExecutions,
} from './modules/eventing/infrastructure/persistence/eventing-attempt.persistence';
import { unwrapTypeOrmMutationRows } from './modules/eventing/infrastructure/persistence/typeorm-mutation-result';

const now = new Date('2030-01-01T00:00:00Z');
const outbox = { eventId: 'event', workspaceId: 'workspace', attemptNumber: 1 };
const consumption = { ...outbox, consumptionId: 'consumption', consumerKey: 'consumer' };
const webhook = {
  deliveryId: 'delivery', workspaceId: 'workspace', endpointId: 'endpoint',
  attemptId: 'attempt', attemptNumber: 1, endpointVersion: 1,
};
const completion = { status: 'succeeded' as const, finishedAt: now, endpointFailureThreshold: 3 };

function manager(result: unknown, active = true): EntityManager {
  return { queryRunner: { isTransactionActive: active }, query: async () => typeof result === 'function' ? result() : result } as unknown as EntityManager;
}

for (const [name, operation] of [
  ['outbox', (tx: EntityManager) => finishOutboxAttempt(outbox, { status: 'dispatched', at: now }, tx)],
  ['consumption-lock', (tx: EntityManager) => lockConsumption(consumption, tx)],
  ['consumption-finish', (tx: EntityManager) => finishConsumption(consumption, 'succeeded', { processedAt: now }, tx)],
  ['webhook-finish', (tx: EntityManager) => finishWebhookExecution(webhook, completion, tx)],
  ['webhook-recovery', (tx: EntityManager) => recoverWebhookExecutions(now, now, tx)],
] as const) {
  test(`${name} refuses an autocommit manager`, async () => {
    await assert.rejects(operation(manager([], false)), /active transaction/u);
  });
}

test('outbox owner is mandatory and zero changed rows is a stale no-op', async () => {
  await assert.rejects(finishOutboxAttempt(undefined as never, { status: 'dispatched', at: now }, manager([])), /owner/u);
  await assert.rejects(finishOutboxAttempt({ ...outbox, attemptNumber: 0 }, { status: 'dispatched', at: now }, manager([])), /owner/u);
  assert.equal(await finishOutboxAttempt(outbox, { status: 'dispatched', at: now }, manager([[], 0])), false);
  assert.equal(await finishOutboxAttempt(outbox, { status: 'dispatched', at: now }, manager([[{ id: 'event' }], 1])), true);
});

test('consumption owner includes event, workspace and consumer identity', async () => {
  for (const key of ['eventId', 'consumptionId', 'workspaceId', 'consumerKey']) {
    await assert.rejects(lockConsumption({ ...consumption, [key]: '' }, manager([])), /owner/u);
  }
  await assert.rejects(lockConsumption({ ...consumption, attemptNumber: NaN }, manager([])), /owner/u);
});

test('mutation results reject malformed rows and inconsistent affected counts', () => {
  for (const result of [undefined, null, 'bad', [null], [[{ id: 'x' }], 0], [[{ id: 'x' }], NaN], { records: [42] }]) {
    assert.throws(() => unwrapTypeOrmMutationRows(result));
  }
  assert.deepEqual(unwrapTypeOrmMutationRows({ records: [{ id: 'x' }] }), [{ id: 'x' }]);
});

test('a multirow result cannot be treated as an applied singleton mutation', async () => {
  await assert.rejects(finishConsumption(consumption, 'failed', { processedAt: now }, manager([{ id: 'a' }, { id: 'b' }])), /mutation rows/u);
});

test('webhook completion rejects missing identity and impossible retry policies', async () => {
  for (const owner of [undefined, { ...webhook, attemptId: '' }, { ...webhook, endpointVersion: 0 }]) {
    await assert.rejects(finishWebhookExecution(owner as never, completion, manager([])));
  }
  await assert.rejects(finishWebhookExecution(webhook, { ...completion, status: 'retry_scheduled' }, manager([])));
  await assert.rejects(finishWebhookExecution(webhook, { ...completion, nextRetryAt: now }, manager([])));
});

test('stale webhook completion stops before touching attempt or endpoint rows', async () => {
  let calls = 0;
  const tx = manager(() => { calls += 1; return []; });
  assert.equal(await finishWebhookExecution(webhook, completion, tx), false);
  assert.equal(calls, 1);
});

test('recovery with a missing current attempt aborts instead of hiding corruption', async () => {
  let calls = 0;
  const tx = manager(() => ++calls === 1 ? [[{ id: 'delivery', attempt_count: 1 }], 1] : [[], 0]);
  await assert.rejects(recoverWebhookExecutions(now, now, tx), /no active matching attempt/u);
});
