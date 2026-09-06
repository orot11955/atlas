import type { ConsumerState, ConsumptionReplayInput } from '../ports/consumer-lifecycle';
import type { Clock } from '../../../core';
import { ActorType, DomainError, ErrorCode, createUuidV7, requestContext, systemClock } from '../../../core';
import {
  EVENT_SCHEMA_VERSION,
  OutboxEventStatus,
  assertUuidV7,
  freezeOutboxEvent,
  type OutboxEventRecord,
} from '../domain/eventing';
import { assertEventData, resolveEventContract } from '../domain/event-contract';
import type { EventingRepositoryPort } from '../ports/eventing.repository';
import type { OutboxRecorderPort, RecordOutboxEventInput } from '../ports/outbox-recorder.port';

const EVENT_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const MAXIMUM_EVENT_DATA_BYTES = 262_144;

export class OutboxService<TTransaction> implements OutboxRecorderPort<TTransaction> {
  public constructor(
    private readonly repository: EventingRepositoryPort<TTransaction>,
    private readonly clock: Clock = systemClock,
  ) {}

  public async record(
    input: Readonly<RecordOutboxEventInput>,
    transaction: TTransaction,
  ): Promise<Readonly<OutboxEventRecord>> {
    assertUuidV7(input.workspaceId, 'workspaceId');
    assertUuidV7(input.aggregateId, 'aggregateId');

    if (input.siteId) {
      assertUuidV7(input.siteId, 'siteId');
    }

    validateEventKey(input.aggregateType, 'aggregateType', 80);
    validateEventKey(input.eventType, 'eventType', 120);
    const context = requestContext.require();

    if (context.workspaceId && context.workspaceId !== input.workspaceId) {
      throw new DomainError({
        code: ErrorCode.FORBIDDEN,
        message: 'Outbox Event Workspace does not match the request context.',
      });
    }

    if (context.siteId && input.siteId && context.siteId !== input.siteId) {
      throw new DomainError({
        code: ErrorCode.FORBIDDEN,
        message: 'Outbox Event Site does not match the request context.',
      });
    }

    const occurredAt = this.clock.now();
    const eventId = createUuidV7(occurredAt.getTime());
    const availableAt = input.availableAt ? new Date(input.availableAt) : occurredAt;

    if (Number.isNaN(availableAt.getTime())) {
      throw new DomainError({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Outbox Event availableAt must be a valid date.',
        details: { field: 'availableAt' },
      });
    }

    const record: OutboxEventRecord = {
      id: eventId,
      workspaceId: input.workspaceId,
      siteId: input.siteId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      schemaVersion: EVENT_SCHEMA_VERSION,
      payload: {
        eventId,
        eventType: input.eventType,
        occurredAt: occurredAt.toISOString(),
        workspaceId: input.workspaceId,
        siteId: input.siteId ?? null,
        aggregateId: input.aggregateId,
        schemaVersion: EVENT_SCHEMA_VERSION,
        data: normalizeEventData(input.data),
      },
      status: OutboxEventStatus.PENDING,
      availableAt,
      attemptCount: 0,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };

    // Reject invalid new events before persistence, inside the caller's domain transaction.
    resolveEventContract(record);
    await this.repository.insertOutboxEvent(record, transaction);
    return freezeOutboxEvent(record);
  }
}

function validateEventKey(value: string, field: string, maximumLength: number): void {
  if (!EVENT_KEY_PATTERN.test(value) || value.length > maximumLength) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: `${field} must be a lowercase dot, underscore or hyphen separated key.`,
      details: { field },
    });
  }
}

function normalizeEventData(
  value: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  let serialized: string;

  try {
    serialized = JSON.stringify(value ?? {});
    if (typeof serialized !== 'string') throw new Error('Not a serialized JSON value.');
  } catch {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Outbox Event data must be JSON serializable.',
      details: { field: 'data' },
    });
  }

  if (Buffer.byteLength(serialized, 'utf8') > MAXIMUM_EVENT_DATA_BYTES) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Outbox Event data cannot exceed 256 KiB.',
      details: { field: 'data' },
    });
  }

  const parsed = JSON.parse(serialized) as unknown;

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Outbox Event data must be a JSON object.',
      details: { field: 'data' },
    });
  }

  assertEventData(parsed as Record<string, unknown>);
  return deepFreezeJson(parsed) as Readonly<Record<string, unknown>>;
}

function deepFreezeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(deepFreezeJson));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, deepFreezeJson(nested)]),
      ),
    );
  }

  return value;
}

export class OutboxAdministrationService<TTransaction> {
  public constructor(
    private readonly transactionRunner: import('../../../core').TransactionRunner<TTransaction>,
    private readonly repository: EventingRepositoryPort<TTransaction>,
    private readonly auditService: import('../../../core').AuditService<TTransaction>,
    private readonly clock: Clock = systemClock,
  ) {}

  public async list(
    workspaceId: string,
    query: Readonly<{ status?: OutboxEventStatus; limit?: number }> = {},
  ): Promise<readonly Readonly<OutboxEventRecord>[]> {
    const limit = query.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new DomainError({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Outbox Event limit must be between 1 and 200.',
        details: { field: 'limit' },
      });
    }
    const records = await this.repository.listOutboxEvents(workspaceId, {
      status: query.status,
      limit,
    });
    return Object.freeze(records.map(freezeOutboxEvent));
  }

  public listConsumptions(workspaceId: string, status?: ConsumerState, limit = 50) {
    assertConsumptionLimit(limit);
    return this.repository.listConsumptions(workspaceId, status, limit);
  }

  public consumptionHistory(workspaceId: string, eventId: string, limit = 50) {
    assertConsumptionLimit(limit);
    return this.repository.consumptionHistory(workspaceId, eventId, limit);
  }

  public async replayConsumption(workspaceId: string, input: Readonly<ConsumptionReplayInput>) {
    const context = requestContext.require();
    if (context.actorType !== ActorType.ADMIN || !context.actorId || context.workspaceId !== workspaceId) {
      throw new DomainError({ code: ErrorCode.FORBIDDEN, message: 'A Workspace-scoped administrator is required.' });
    }
    return this.transactionRunner.run(async (tx) => {
      const event = await this.repository.findOutboxEvent(input.eventId, tx);
      if (!event || event.workspaceId !== workspaceId) {
        throw new DomainError({ code: ErrorCode.NOT_FOUND, message: 'Consumer Event was not found.' });
      }
      // An invalid immutable contract cannot be repaired by replay. Upgrade its handler or
      // issue a distinct, audited domain command; never rewrite the historical payload.
      resolveEventContract(event);
      const result = await this.repository.replayConsumption(workspaceId, context.actorId!, input, this.clock.now(), tx);
      if (!result.replayed) await this.auditService.record({
        action: 'outbox.consumption-replay-requested', targetType: 'outbox-event', targetId: input.eventId,
        metadata: { replayId: input.replayId, previousAttempt: result.previousAttempt,
          attemptLimit: result.attemptLimit, reason: input.reason },
      }, tx);
      return result;
    });
  }

  public async retry(workspaceId: string, eventId: string): Promise<void> {
    const retriedAt = this.clock.now();
    await this.transactionRunner.run(async (transaction) => {
      const retried = await this.repository.retryDeadOutboxEvent(
        workspaceId,
        eventId,
        retriedAt,
        transaction,
      );
      if (!retried) {
        throw new DomainError({
          code: ErrorCode.INVALID_STATE_TRANSITION,
          message: 'Only dead Outbox Events can be retried.',
        });
      }
      await this.auditService.record(
        {
          action: 'outbox.event-retry-requested',
          targetType: 'outbox-event',
          targetId: eventId,
          metadata: { availableAt: retriedAt.toISOString() },
        },
        transaction,
      );
    });
  }
}

function assertConsumptionLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new DomainError({ code: ErrorCode.VALIDATION_FAILED, message: 'Consumer limit must be between 1 and 200.' });
  }
}
