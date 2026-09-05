import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ActorType,
  Aes256GcmWebhookSecretCipher,
  EventType,
  FixedClock,
  OutboxConsumerService,
  OutboxEventStatus,
  OutboxService,
  PublicationScheduleAction,
  PublicationScheduleProcessor,
  PublicationScheduleStatus,
  WebhookDeliveryService,
  WebhookDeliveryStatus,
  WebhookEndpointStatus,
  createUuidV7,
  createWebhookSignature,
  formatLocalDateTime,
  isPrivateHostname,
  localDateTimeToUtc,
  normalizeScheduledFor,
  normalizeWebhookEventTypes,
  normalizeWebhookUrl,
  requestContext,
  retryAt,
  unwrapTypeOrmMutationRows,
  verifyWebhookSignature,
  type AuditService,
  type EventingRepositoryPort,
  type OutboxEventRecord,
  type PublicationCommandPort,
  type PublicationScheduleRecord,
  type TransactionRunner,
  type WebhookDeliveryExecution,
} from './index';

test('Webhook signatures bind timestamp, event ID and exact body', () => {
  const secret = 's'.repeat(48);
  const timestamp = '1788487200';
  const eventId = createUuidV7(1);
  const body = JSON.stringify({ eventId, eventType: EventType.CONTENT_PUBLISHED });
  const signature = createWebhookSignature(secret, timestamp, eventId, body);

  assert.match(signature, /^v1=[a-f0-9]{64}$/u);
  assert.equal(verifyWebhookSignature(secret, timestamp, eventId, body, signature), true);
  assert.equal(verifyWebhookSignature(secret, timestamp, eventId, `${body} `, signature), false);
  assert.equal(verifyWebhookSignature(secret, '1788487201', eventId, body, signature), false);
});

test('Webhook URL policy blocks credentials, fragments and private networks by default', () => {
  assert.equal(
    normalizeWebhookUrl(' https://hooks.example.com/atlas ', {
      allowHttp: false,
      allowPrivateNetwork: false,
    }),
    'https://hooks.example.com/atlas',
  );
  assert.throws(() =>
    normalizeWebhookUrl('http://hooks.example.com/atlas', {
      allowHttp: false,
      allowPrivateNetwork: false,
    }),
  );
  assert.throws(() =>
    normalizeWebhookUrl('https://user:secret@hooks.example.com/atlas', {
      allowHttp: false,
      allowPrivateNetwork: false,
    }),
  );
  assert.throws(() =>
    normalizeWebhookUrl('https://127.0.0.1/atlas', {
      allowHttp: false,
      allowPrivateNetwork: false,
    }),
  );

  assert.equal(isPrivateHostname('fcdn.example.com'), false);
  assert.equal(isPrivateHostname('fd-service.example.com'), false);
  assert.equal(isPrivateHostname('8.8.8.8'), false);
  assert.equal(isPrivateHostname('2606:4700:4700::1111'), false);

  for (const hostname of [
    'localhost',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.1.1',
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:192.168.1.1',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '2001:db8::1',
  ]) {
    assert.equal(isPrivateHostname(hostname), true, hostname);
  }
});

test('Webhook event normalization is unique, stable and allow-listed', () => {
  assert.deepEqual(
    normalizeWebhookEventTypes([
      EventType.CONTENT_PUBLISHED,
      EventType.CONTENT_UNPUBLISHED,
      EventType.CONTENT_PUBLISHED,
    ]),
    [EventType.CONTENT_PUBLISHED, EventType.CONTENT_UNPUBLISHED],
  );
  assert.throws(() => normalizeWebhookEventTypes(['content.deleted']));
  assert.throws(() => normalizeWebhookEventTypes([]));
});

test('Webhook secrets use authenticated AES-256-GCM encryption and key version binding', () => {
  const cipher = new Aes256GcmWebhookSecretCipher(Buffer.alloc(32, 7).toString('base64'), 'v1');
  const secret = 'atlas_webhook_'.padEnd(48, 'x');
  const encrypted = cipher.encrypt(secret);

  assert.notEqual(encrypted.encryptedValue, secret);
  assert.equal(cipher.decrypt(encrypted.encryptedValue, encrypted.keyVersion), secret);
  assert.throws(() => cipher.decrypt(encrypted.encryptedValue, 'v2'));

  const tamperedParts = encrypted.encryptedValue.split('.');
  const ciphertext = Buffer.from(tamperedParts[3] ?? '', 'base64url');
  assert.ok(ciphertext.length > 0);
  ciphertext[0] = (ciphertext[0] ?? 0) ^ 0x01;
  tamperedParts[3] = ciphertext.toString('base64url');

  assert.throws(() => cipher.decrypt(tamperedParts.join('.'), encrypted.keyVersion));
});

test('TypeORM mutation results are normalized without leaking driver tuples', () => {
  const rows = [{ id: 'row-1' }];

  assert.deepEqual(unwrapTypeOrmMutationRows<(typeof rows)[number]>([rows, 1]), rows);
  assert.deepEqual(unwrapTypeOrmMutationRows<(typeof rows)[number]>(rows), rows);
  assert.deepEqual(unwrapTypeOrmMutationRows<(typeof rows)[number]>({ records: rows }), rows);
  assert.throws(() => unwrapTypeOrmMutationRows('unsupported'));
});

test('Publication local time conversion is host-timezone independent and rejects invalid windows', () => {
  const local = '2026-09-05T09:30:00';
  const utc = localDateTimeToUtc(local, 'Asia/Seoul');

  assert.equal(utc.toISOString(), '2026-09-05T00:30:00.000Z');
  assert.equal(formatLocalDateTime(utc, 'Asia/Seoul'), local);
  assert.throws(() => localDateTimeToUtc('2026-02-30T09:00', 'Asia/Seoul'));
  assert.throws(() => localDateTimeToUtc('2026-03-08T02:30:00', 'America/New_York'));
  assert.throws(() => localDateTimeToUtc('2026-11-01T01:30:00', 'America/New_York'));

  const now = new Date('2026-09-04T00:00:00.000Z');
  assert.equal(
    normalizeScheduledFor(new Date('2026-09-04T00:00:30.000Z'), now).toISOString(),
    '2026-09-04T00:00:30.000Z',
  );
  assert.throws(() => normalizeScheduledFor(new Date('2026-09-04T00:00:29.999Z'), now));
  assert.equal(retryAt(now, 2, [1_000, 2_000])?.toISOString(), '2026-09-04T00:00:02.000Z');
  assert.equal(retryAt(now, 3, [1_000, 2_000]), undefined);
});

test('OutboxService records an immutable request-scoped event envelope', async () => {
  const clock = new FixedClock('2026-09-04T00:00:00.000Z');
  const inserted: OutboxEventRecord[] = [];
  const repository = {
    insertOutboxEvent: (record: OutboxEventRecord) => {
      inserted.push(record);
      return Promise.resolve();
    },
  } as unknown as EventingRepositoryPort<symbol>;
  const service = new OutboxService(repository, clock);
  const workspaceId = createUuidV7(10);
  const siteId = createUuidV7(11);
  const publicationId = createUuidV7(12);

  const event = await requestContext.run(
    {
      requestId: createUuidV7(13),
      traceId: createUuidV7(14),
      actorType: ActorType.ADMIN,
      actorId: createUuidV7(15),
      workspaceId,
      siteId,
    },
    () =>
      service.record(
        {
          workspaceId,
          siteId,
          aggregateType: 'content-publication',
          aggregateId: publicationId,
          eventType: EventType.CONTENT_PUBLISHED,
          data: { publicationId },
        },
        Symbol('transaction'),
      ),
  );

  assert.equal(inserted.length, 1);
  assert.equal(event.status, OutboxEventStatus.PENDING);
  assert.equal(event.payload.eventId, event.id);
  assert.equal(event.payload.workspaceId, workspaceId);
  assert.equal(event.payload.siteId, siteId);
  assert.equal(event.payload.data.publicationId, publicationId);
  assert.equal(event.availableAt.toISOString(), '2026-09-04T00:00:00.000Z');
  assert.equal(Object.isFrozen(event.payload), true);
  assert.equal(Object.isFrozen(event.payload.data), true);

  const nestedEvent = await requestContext.run(
    {
      requestId: createUuidV7(16),
      traceId: createUuidV7(17),
      actorType: ActorType.ADMIN,
      actorId: createUuidV7(18),
      workspaceId,
      siteId,
    },
    () =>
      service.record(
        {
          workspaceId,
          siteId,
          aggregateType: 'content-publication',
          aggregateId: publicationId,
          eventType: EventType.CONTENT_PUBLISHED,
          data: { nested: { values: [1, { stable: true }] } },
        },
        Symbol('transaction'),
      ),
  );
  const nested = nestedEvent.payload.data.nested as {
    values: readonly [number, Readonly<{ stable: boolean }>];
  };
  assert.equal(Object.isFrozen(nested), true);
  assert.equal(Object.isFrozen(nested.values), true);
  assert.equal(Object.isFrozen(nested.values[1]), true);

  await assert.rejects(
    requestContext.run(
      {
        requestId: createUuidV7(19),
        traceId: createUuidV7(20),
        actorType: ActorType.ADMIN,
        actorId: createUuidV7(21),
        workspaceId,
      },
      () =>
        service.record(
          {
            workspaceId,
            aggregateType: 'content-publication',
            aggregateId: publicationId,
            eventType: EventType.CONTENT_PUBLISHED,
            availableAt: new Date(Number.NaN),
          },
          Symbol('transaction'),
        ),
    ),
    /availableAt/u,
  );

  await assert.rejects(
    requestContext.run(
      {
        requestId: createUuidV7(22),
        traceId: createUuidV7(23),
        actorType: ActorType.ADMIN,
        actorId: createUuidV7(24),
        workspaceId,
      },
      () =>
        service.record(
          {
            workspaceId,
            aggregateType: 'content-publication',
            aggregateId: publicationId,
            eventType: EventType.CONTENT_PUBLISHED,
            data: { oversized: 'x'.repeat(262_145) },
          },
          Symbol('transaction'),
        ),
    ),
    /256 KiB/u,
  );
});

test('OutboxConsumerService applies a duplicate Event effect only once', async () => {
  const now = new Date('2026-09-04T00:00:00.000Z');
  const workspaceId = createUuidV7(100);
  const siteId = createUuidV7(101);
  const eventId = createUuidV7(102);
  const endpointId = createUuidV7(103);
  const deliveryId = createUuidV7(104);
  const consumptionId = createUuidV7(105);
  const event: OutboxEventRecord = {
    id: eventId,
    workspaceId,
    siteId,
    aggregateType: 'content-publication',
    aggregateId: createUuidV7(106),
    eventType: EventType.CONTENT_PUBLISHED,
    schemaVersion: 1,
    payload: {
      eventId,
      eventType: EventType.CONTENT_PUBLISHED,
      occurredAt: now.toISOString(),
      workspaceId,
      siteId,
      aggregateId: createUuidV7(107),
      schemaVersion: 1,
      data: {},
    },
    status: OutboxEventStatus.PROCESSING,
    availableAt: now,
    claimedAt: now,
    attemptCount: 1,
    createdAt: now,
    updatedAt: now,
  };
  let claimed = false;
  let insertedDeliveries = 0;
  let enqueuedDeliveries = 0;
  const repository = {
    findOutboxEvent: () => Promise.resolve(event),
    claimEventConsumption: () => {
      if (claimed) return Promise.resolve(undefined);
      claimed = true;
      return Promise.resolve({
        id: consumptionId,
        consumerKey: 'atlas.eventing.v1',
        eventId,
        status: 'processing',
        attemptCount: 1,
        claimedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    },
    listActiveWebhookEndpointsForEvent: () =>
      Promise.resolve([
        {
          id: endpointId,
          workspaceId,
          siteId,
          name: 'Receiver',
          url: 'https://hooks.example.com/atlas',
          status: 'active',
          secretCiphertext: 'ciphertext',
          secretKeyVersion: 'v1',
          subscribedEvents: [EventType.CONTENT_PUBLISHED],
          consecutiveFailureCount: 0,
          version: 1,
          createdByAdminAccountId: createUuidV7(108),
          createdAt: now,
          updatedAt: now,
        },
      ]),
    insertWebhookDeliveryIfAbsent: () => {
      insertedDeliveries += 1;
      return Promise.resolve({
        id: deliveryId,
        workspaceId,
        endpointId,
        eventId,
        eventType: EventType.CONTENT_PUBLISHED,
        status: 'pending',
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    },
    completeEventConsumption: () => Promise.resolve(),
  } as unknown as EventingRepositoryPort<symbol>;
  const queue = {
    enqueueOutboxEvent: () => Promise.resolve(),
    enqueueWebhookDelivery: () => {
      enqueuedDeliveries += 1;
      return Promise.resolve();
    },
    enqueuePublicationSchedule: () => Promise.resolve(),
  };
  const transactionRunner = {
    run: <TResult>(work: (transaction: symbol) => Promise<TResult>) => work(Symbol('transaction')),
  };
  const auditService = { record: () => Promise.resolve({}) };
  const service = new OutboxConsumerService(
    transactionRunner,
    repository,
    queue,
    auditService as never,
    { staleMilliseconds: 30_000 },
    new FixedClock(now),
  );

  assert.deepEqual(await service.consume(eventId), { duplicate: false, effects: 1 });
  assert.deepEqual(await service.consume(eventId), { duplicate: true, effects: 0 });
  assert.equal(insertedDeliveries, 1);
  assert.equal(enqueuedDeliveries, 1);
});

test('PublicationScheduleProcessor conditionally claims a duplicate Schedule only once', async () => {
  const now = new Date('2026-09-04T00:00:00.000Z');
  const schedule = {
    id: createUuidV7(200),
    workspaceId: createUuidV7(201),
    siteId: createUuidV7(202),
    contentId: createUuidV7(203),
    contentSiteId: createUuidV7(204),
    action: 'publish' as const,
    scheduledFor: now,
    timezone: 'UTC',
    scheduledLocalAt: '2026-09-04T00:00:00',
    status: 'processing' as const,
    attemptCount: 1,
    nextAttemptAt: now,
    version: 2,
    requestedByAdminAccountId: createUuidV7(205),
    createdAt: now,
    updatedAt: now,
  };
  let claimCount = 0;
  let publishCount = 0;
  let completeCount = 0;
  const repository = {
    startPublicationScheduleAttempt: () => {
      claimCount += 1;
      return Promise.resolve(claimCount === 1 ? schedule : undefined);
    },
    completePublicationSchedule: () => {
      completeCount += 1;
      return Promise.resolve();
    },
  } as unknown as EventingRepositoryPort<symbol>;
  const transactionRunner = {
    run: <TResult>(work: (transaction: symbol) => Promise<TResult>) => work(Symbol('transaction')),
  };
  const command = {
    publish: () => {
      publishCount += 1;
      return Promise.resolve({ replayed: false });
    },
    withdraw: () => Promise.resolve({ replayed: false }),
  };
  const auditService = { record: () => Promise.resolve({}) };
  const processor = new PublicationScheduleProcessor(
    transactionRunner,
    repository,
    command,
    auditService as never,
    new FixedClock(now),
  );

  await processor.process(schedule.id, 1);
  await processor.process(schedule.id, 1);

  assert.equal(publishCount, 1);
  assert.equal(completeCount, 1);
});

test('Webhook delivery failure persists a due retry without pre-enqueuing a conflicting job', async () => {
  const clock = new FixedClock('2026-09-04T00:00:00.000Z');
  const execution = createWebhookExecution(clock);
  let completedDelivery:
    | Readonly<{
        status: WebhookDeliveryStatus;
        nextRetryAt?: Date;
        completedAt?: Date;
        updatedAt: Date;
      }>
    | undefined;
  let endpointFailureIncrements = 0;
  const repository = {
    startWebhookDeliveryAttempt: () => Promise.resolve(execution),
    completeWebhookDeliveryAttempt: () => Promise.resolve(),
    completeWebhookDelivery: (
      _deliveryId: string,
      input: Readonly<{
        status: WebhookDeliveryStatus;
        nextRetryAt?: Date;
        completedAt?: Date;
        updatedAt: Date;
      }>,
    ) => {
      completedDelivery = input;
      return Promise.resolve();
    },
    incrementWebhookEndpointFailures: () => {
      endpointFailureIncrements += 1;
      return Promise.resolve({ failureCount: 1, disabled: false });
    },
  } as unknown as EventingRepositoryPort<symbol>;
  const service = new WebhookDeliveryService(
    passthroughRunner<symbol>(),
    repository,
    { send: () => Promise.resolve({ status: 503, bodyExcerpt: 'retry' }) },
    {
      encrypt: () => ({ encryptedValue: 'unused', keyVersion: 'v1' }),
      decrypt: () => 's'.repeat(48),
    },
    noOpAuditService<symbol>(),
    { timeoutMilliseconds: 1_000, endpointFailureThreshold: 3 },
    clock,
  );

  await service.deliver(execution.delivery.id, 1);

  assert.equal(completedDelivery?.status, WebhookDeliveryStatus.RETRY_SCHEDULED);
  assert.equal(completedDelivery?.nextRetryAt?.toISOString(), '2026-09-04T00:01:00.000Z');
  assert.equal(completedDelivery?.completedAt, undefined);
  assert.equal(endpointFailureIncrements, 0);
});

test('Publication schedule retry is persisted for relay recovery without a duplicate delayed job', async () => {
  const clock = new FixedClock('2026-09-04T00:00:00.000Z');
  const schedule = createPublicationSchedule(clock);
  let rescheduled:
    Readonly<{ nextAttemptAt: Date; terminal: boolean; updatedAt: Date }> | undefined;
  const repository = {
    startPublicationScheduleAttempt: () => Promise.resolve(schedule),
    reschedulePublicationSchedule: (
      _scheduleId: string,
      nextAttemptAt: Date,
      _error: string,
      terminal: boolean,
      updatedAt: Date,
    ) => {
      rescheduled = { nextAttemptAt, terminal, updatedAt };
      return Promise.resolve();
    },
  } as unknown as EventingRepositoryPort<symbol>;
  const command = {
    publish: () => Promise.reject(new Error('temporary publication failure')),
    withdraw: () => Promise.resolve(),
  } satisfies PublicationCommandPort;
  const processor = new PublicationScheduleProcessor(
    passthroughRunner<symbol>(),
    repository,
    command,
    noOpAuditService<symbol>(),
    clock,
  );

  await assert.rejects(processor.process(schedule.id, 1), /temporary publication failure/u);
  assert.equal(rescheduled?.terminal, false);
  assert.equal(rescheduled?.nextAttemptAt.toISOString(), '2026-09-04T00:01:00.000Z');
  assert.equal(rescheduled?.updatedAt.toISOString(), '2026-09-04T00:00:00.000Z');
});

function passthroughRunner<TTransaction>(): TransactionRunner<TTransaction> {
  return {
    run: <TResult>(work: (transaction: TTransaction) => Promise<TResult>) =>
      work(Symbol('transaction') as TTransaction),
  };
}

function noOpAuditService<TTransaction>(): AuditService<TTransaction> {
  return {
    record: () => Promise.resolve({}),
  } as unknown as AuditService<TTransaction>;
}

function createWebhookExecution(clock: FixedClock): WebhookDeliveryExecution {
  const workspaceId = createUuidV7(300);
  const siteId = createUuidV7(301);
  const eventId = createUuidV7(302);
  const deliveryId = createUuidV7(303);
  const endpointId = createUuidV7(304);
  const aggregateId = createUuidV7(305);

  return {
    delivery: {
      id: deliveryId,
      workspaceId,
      endpointId,
      eventId,
      eventType: EventType.CONTENT_PUBLISHED,
      status: WebhookDeliveryStatus.PROCESSING,
      attemptCount: 1,
      createdAt: clock.now(),
      updatedAt: clock.now(),
    },
    endpoint: {
      id: endpointId,
      workspaceId,
      siteId,
      name: 'Webhook',
      url: 'https://hooks.example.com/atlas',
      status: WebhookEndpointStatus.ACTIVE,
      secretCiphertext: 'encrypted',
      secretKeyVersion: 'v1',
      subscribedEvents: [EventType.CONTENT_PUBLISHED],
      consecutiveFailureCount: 0,
      version: 1,
      createdByAdminAccountId: createUuidV7(306),
      createdAt: clock.now(),
      updatedAt: clock.now(),
    },
    event: {
      id: eventId,
      workspaceId,
      siteId,
      aggregateType: 'content-publication',
      aggregateId,
      eventType: EventType.CONTENT_PUBLISHED,
      schemaVersion: 1,
      payload: {
        eventId,
        eventType: EventType.CONTENT_PUBLISHED,
        occurredAt: clock.now().toISOString(),
        workspaceId,
        siteId,
        aggregateId,
        schemaVersion: 1,
        data: {},
      },
      status: OutboxEventStatus.DISPATCHED,
      availableAt: clock.now(),
      dispatchedAt: clock.now(),
      attemptCount: 1,
      createdAt: clock.now(),
      updatedAt: clock.now(),
    },
    attempt: {
      id: createUuidV7(307),
      deliveryId,
      attemptNumber: 1,
      status: 'processing',
      requestBody: '{}',
      requestedAt: clock.now(),
    },
  };
}

function createPublicationSchedule(clock: FixedClock): PublicationScheduleRecord {
  return {
    id: createUuidV7(400),
    workspaceId: createUuidV7(401),
    siteId: createUuidV7(402),
    contentId: createUuidV7(403),
    contentSiteId: createUuidV7(404),
    action: PublicationScheduleAction.PUBLISH,
    scheduledFor: clock.now(),
    timezone: 'UTC',
    scheduledLocalAt: '2026-09-04T00:00:00',
    status: PublicationScheduleStatus.PROCESSING,
    attemptCount: 1,
    nextAttemptAt: clock.now(),
    version: 2,
    requestedByAdminAccountId: createUuidV7(405),
    createdAt: clock.now(),
    updatedAt: clock.now(),
  };
}
