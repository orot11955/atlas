import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActorType, FixedClock, createUuidV7, requestContext } from './core';
import { OutboxConsumerService } from './modules/eventing/application/outbox-relay.service';
import { OutboxService } from './modules/eventing/application/outbox.service';
import { EventContractError } from './modules/eventing/domain/event-contract';
import type { OutboxEventRecord } from './modules/eventing/domain/eventing';
import type { EventingRepositoryPort } from './modules/eventing/ports/eventing.repository';

const now = new Date('2030-01-01T00:00:00.000Z');
function invalidEvent(): OutboxEventRecord {
  const id = createUuidV7();
  const workspaceId = createUuidV7();
  const aggregateId = createUuidV7();
  return {
    id,
    workspaceId,
    aggregateId,
    aggregateType: 'content-publication',
    eventType: 'content.sensitive-marker',
    schemaVersion: 1,
    status: 'dispatched',
    availableAt: now,
    attemptCount: 1,
    createdAt: now,
    updatedAt: now,
    payload: {
      eventId: id,
      workspaceId,
      aggregateId,
      siteId: null,
      eventType: 'content.sensitive-marker',
      schemaVersion: 1,
      occurredAt: now.toISOString(),
      data: {},
    },
  };
}

test('producer rejects unregistered events before insertion', async () => {
  let writes = 0;
  const repository = {
    insertOutboxEvent: async () => {
      writes += 1;
    },
  } as unknown as EventingRepositoryPort<symbol>;
  const service = new OutboxService(repository, new FixedClock(now));
  const value = invalidEvent();
  await assert.rejects(
    requestContext.run(
      {
        requestId: createUuidV7(),
        traceId: createUuidV7(),
        actorType: ActorType.SYSTEM,
        workspaceId: value.workspaceId,
      },
      () =>
        service.record(
          {
            workspaceId: value.workspaceId,
            aggregateId: value.aggregateId,
            aggregateType: value.aggregateType,
            eventType: value.eventType,
            data: {},
          },
          Symbol('transaction'),
        ),
    ),
    EventContractError,
  );
  assert.equal(writes, 0);
});

for (const current of [true, false]) {
  test(`consumer contract failure respects receipt ownership (${current})`, async () => {
    const value = invalidEvent();
    const receipt = {
      id: createUuidV7(),
      eventId: value.id,
      consumerKey: 'atlas.eventing.v1',
      attemptCount: 1,
    };
    const writes: Array<{ status: string; transaction: symbol }> = [];
    const audits: Array<{ input: unknown; transaction: symbol }> = [];
    let queueCalls = 0;
    let locks = 0;
    const repository = {
      findOutboxEvent: async () => value,
      claimEventConsumption: async () => receipt,
      lockEventConsumption: async () => {
        locks += 1;
        return current;
      },
      completeEventConsumption: async (
        _owner: unknown,
        status: string,
        _input: unknown,
        transaction: symbol,
      ) => {
        writes.push({ status, transaction });
        return true;
      },
      listActiveWebhookEndpointsForEvent: async () => {
        throw new Error('Invalid event reached effects.');
      },
    } as unknown as EventingRepositoryPort<symbol>;
    const queue = {
      enqueueOutboxEvent: async () => {
        queueCalls += 1;
      },
      enqueueWebhookDelivery: async () => {
        queueCalls += 1;
      },
      enqueuePublicationSchedule: async () => {
        queueCalls += 1;
      },
    };
    const runner = { run: <T>(work: (tx: symbol) => Promise<T>) => work(Symbol('transaction')) };
    const audit = {
      record: async (input: unknown, transaction: symbol) => {
        audits.push({ input, transaction });
      },
    };
    const consumer = new OutboxConsumerService(
      runner,
      repository,
      queue,
      audit as never,
      { staleMilliseconds: 30_000 },
      new FixedClock(now),
    );
    if (current) {
      await assert.rejects(consumer.consume(value.id), EventContractError);
      assert.equal(writes.length, 1);
      assert.equal(writes[0]?.status, 'failed');
      assert.equal(audits.length, 1);
      assert.equal(writes[0]?.transaction, audits[0]?.transaction);
      assert.doesNotMatch(JSON.stringify(audits[0]?.input), /sensitive-marker/);
      assert.match(JSON.stringify(audits[0]?.input), /VALIDATION_FAILED/);
    } else {
      assert.deepEqual(await consumer.consume(value.id), { duplicate: true, effects: 0 });
      assert.equal(writes.length, 0);
      assert.equal(audits.length, 0);
    }
    assert.equal(locks, 1);
    assert.equal(queueCalls, 0);
  });
}
