import type { AuditService, Clock, TransactionRunner } from '../../../core';
import {
  ActorType,
  AuditResult,
  DomainError,
  ErrorCode,
  createUuidV7,
  isUuidV7,
  requestContext,
  systemClock,
} from '../../../core';
import {
  EventType,
  OutboxEventStatus,
  WebhookDeliveryStatus,
  isWebhookEventType,
  truncateOperationalMessage,
  type OutboxEventRecord,
} from '../domain/eventing';
import type { EventingQueuePort } from '../ports/eventing-queue.port';
import type { EventingRepositoryPort } from '../ports/eventing.repository';

const OUTBOX_RETRY_DELAYS_MS = Object.freeze([5_000, 30_000, 120_000, 600_000, 3_600_000]);
export const EVENTING_CONSUMER_KEY = 'atlas.eventing.v1';

export class OutboxRelayService<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: EventingRepositoryPort<TTransaction>,
    private readonly queue: EventingQueuePort,
    private readonly options: Readonly<{
      outboxBatchSize: number;
      outboxStaleMilliseconds: number;
      webhookBatchSize: number;
      webhookStaleMilliseconds: number;
      publicationBatchSize: number;
      publicationStaleMilliseconds: number;
      maximumAttempts: number;
    }>,
    private readonly clock: Clock = systemClock,
  ) {}

  public async relayAvailable(): Promise<number> {
    const now = this.clock.now();
    const staleBefore = new Date(now.getTime() - this.options.outboxStaleMilliseconds);
    const events = await this.transactionRunner.run((transaction) =>
      this.repository.claimAvailableOutboxEvents(
        now,
        staleBefore,
        this.options.outboxBatchSize,
        transaction,
      ),
    );

    for (const event of events) {
      try {
        await this.queue.enqueueOutboxEvent({
          eventId: event.id,
          availableAt: event.availableAt,
          correlationId: event.id,
        });
        const dispatchedAt = this.clock.now();
        await this.transactionRunner.run((transaction) =>
          this.repository.markOutboxEventDispatched(event.id, dispatchedAt, transaction),
        );
      } catch (error) {
        await this.handleFailure(event, error);
      }
    }

    return events.length;
  }

  public async recoverDueWork(): Promise<{ schedules: number; deliveries: number }> {
    const now = this.clock.now();
    const publicationStaleBefore = new Date(
      now.getTime() - this.options.publicationStaleMilliseconds,
    );
    const webhookStaleBefore = new Date(now.getTime() - this.options.webhookStaleMilliseconds);

    await this.transactionRunner.run(async (transaction) => {
      await this.repository.recoverStalePublicationSchedules(
        publicationStaleBefore,
        now,
        transaction,
      );
      await this.repository.recoverStaleWebhookDeliveries(webhookStaleBefore, now, transaction);
    });

    const [schedules, deliveries] = await Promise.all([
      this.repository.listDuePublicationSchedules(now, this.options.publicationBatchSize),
      this.repository.listDueWebhookDeliveries(now, this.options.webhookBatchSize),
    ]);

    for (const schedule of schedules) {
      await this.queue.enqueuePublicationSchedule({
        scheduleId: schedule.id,
        attemptNumber: schedule.attemptCount + 1,
        availableAt: schedule.nextAttemptAt,
        correlationId: schedule.id,
      });
    }

    for (const delivery of deliveries) {
      await this.queue.enqueueWebhookDelivery({
        deliveryId: delivery.id,
        attemptNumber: delivery.attemptCount + 1,
        availableAt: delivery.nextRetryAt ?? now,
        correlationId: delivery.eventId,
      });
    }

    return { schedules: schedules.length, deliveries: deliveries.length };
  }

  private async handleFailure(event: Readonly<OutboxEventRecord>, error: unknown): Promise<void> {
    const failedAt = this.clock.now();
    const delay =
      OUTBOX_RETRY_DELAYS_MS[Math.min(event.attemptCount - 1, OUTBOX_RETRY_DELAYS_MS.length - 1)] ??
      3_600_000;
    const terminal = event.attemptCount >= this.options.maximumAttempts;
    const availableAt = terminal ? failedAt : new Date(failedAt.getTime() + delay);
    await this.transactionRunner.run((transaction) =>
      this.repository.rescheduleOutboxEvent(
        event.id,
        availableAt,
        truncateOperationalMessage(error),
        terminal,
        failedAt,
        transaction,
      ),
    );
  }
}

export class OutboxConsumerService<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: EventingRepositoryPort<TTransaction>,
    private readonly queue: EventingQueuePort,
    private readonly auditService: AuditService<TTransaction>,
    private readonly options: Readonly<{ staleMilliseconds: number }>,
    private readonly clock: Clock = systemClock,
  ) {}

  public async consume(
    eventId: string,
  ): Promise<Readonly<{ duplicate: boolean; effects: number }>> {
    const event = await this.repository.findOutboxEvent(eventId);

    if (!event) {
      throw new DomainError({ code: ErrorCode.NOT_FOUND, message: 'Outbox Event was not found.' });
    }
    if (
      event.status !== OutboxEventStatus.PROCESSING &&
      event.status !== OutboxEventStatus.DISPATCHED
    ) {
      throw new DomainError({
        code: ErrorCode.INVALID_STATE_TRANSITION,
        message: 'Only enqueued Outbox Events can be consumed.',
      });
    }

    const parent = requestContext.get();
    const requestId = createUuidV7(this.clock.now().getTime());

    return requestContext.run(
      {
        requestId,
        traceId: parent?.traceId ?? requestId,
        correlationId: event.id,
        actorType: ActorType.SYSTEM,
        actorId: 'worker:outbox-consumer',
        workspaceId: event.workspaceId,
        siteId: event.siteId,
      },
      () => this.consumeInContext(event),
    );
  }

  private async consumeInContext(
    event: Readonly<OutboxEventRecord>,
  ): Promise<Readonly<{ duplicate: boolean; effects: number }>> {
    const now = this.clock.now();
    const staleBefore = new Date(now.getTime() - this.options.staleMilliseconds);
    const consumption = await this.transactionRunner.run((transaction) =>
      this.repository.claimEventConsumption(
        event.id,
        EVENTING_CONSUMER_KEY,
        now,
        staleBefore,
        transaction,
      ),
    );

    if (!consumption) {
      return Object.freeze({ duplicate: true, effects: 0 });
    }

    try {
      const effects = await this.route(event);
      const processedAt = this.clock.now();
      await this.transactionRunner.run(async (transaction) => {
        await this.repository.completeEventConsumption(
          consumption.id,
          'succeeded',
          { processedAt, result: { effects } },
          transaction,
        );
        await this.auditService.record(
          {
            action: 'outbox.event-consumed',
            targetType: 'outbox-event',
            targetId: event.id,
            result: AuditResult.SUCCESS,
            metadata: { eventType: event.eventType, effects },
          },
          transaction,
        );
      });

      return Object.freeze({ duplicate: false, effects });
    } catch (error) {
      const failedAt = this.clock.now();
      await this.transactionRunner.run(async (transaction) => {
        await this.repository.completeEventConsumption(
          consumption.id,
          'failed',
          { processedAt: failedAt, errorMessage: truncateOperationalMessage(error) },
          transaction,
        );
        await this.auditService.record(
          {
            action: 'outbox.event-consumption-failed',
            targetType: 'outbox-event',
            targetId: event.id,
            result: AuditResult.FAILURE,
            errorCode: ErrorCode.INTERNAL_ERROR,
            metadata: { eventType: event.eventType },
          },
          transaction,
        );
      });
      throw error;
    }
  }

  private async route(event: Readonly<OutboxEventRecord>): Promise<number> {
    if (isWebhookEventType(event.eventType) && event.siteId) {
      const endpoints = await this.repository.listActiveWebhookEndpointsForEvent(
        event.workspaceId,
        event.siteId,
        event.eventType,
        event.createdAt,
      );
      const deliveries = [];
      for (const endpoint of endpoints) {
        const createdAt = this.clock.now();
        const delivery = await this.transactionRunner.run((transaction) =>
          this.repository.insertWebhookDeliveryIfAbsent(
            {
              id: eventIdForEffect(event.id, endpoint.id, createdAt),
              workspaceId: event.workspaceId,
              endpointId: endpoint.id,
              eventId: event.id,
              eventType: event.eventType,
              createdAt,
            },
            transaction,
          ),
        );
        deliveries.push(delivery);
      }
      for (const delivery of deliveries) {
        if (
          delivery.status !== WebhookDeliveryStatus.SUCCEEDED &&
          delivery.status !== WebhookDeliveryStatus.DEAD
        ) {
          await this.queue.enqueueWebhookDelivery({
            deliveryId: delivery.id,
            attemptNumber: delivery.attemptCount + 1,
            availableAt: delivery.nextRetryAt ?? this.clock.now(),
            correlationId: event.id,
          });
        }
      }
      return deliveries.length;
    }

    if (
      event.eventType === EventType.PUBLICATION_SCHEDULE_REQUESTED ||
      event.eventType === EventType.PUBLICATION_SCHEDULE_RETRY_REQUESTED
    ) {
      const scheduleId = readUuid(event, 'scheduleId');
      const attemptNumber = readPositiveInteger(event, 'attemptNumber');
      const availableAt = readDate(event, 'availableAt');
      await this.queue.enqueuePublicationSchedule({
        scheduleId,
        attemptNumber,
        availableAt,
        correlationId: event.id,
      });
      return 1;
    }

    if (event.eventType === EventType.WEBHOOK_DELIVERY_RETRY_REQUESTED) {
      const deliveryId = readUuid(event, 'deliveryId');
      const attemptNumber = readPositiveInteger(event, 'attemptNumber');
      const availableAt = readDate(event, 'availableAt');
      await this.queue.enqueueWebhookDelivery({
        deliveryId,
        attemptNumber,
        availableAt,
        correlationId: event.id,
      });
      return 1;
    }

    return 0;
  }
}

function eventIdForEffect(eventId: string, endpointId: string, now: Date): string {
  // The database Unique Constraint is the authoritative idempotency boundary.
  // A UUIDv7 keeps index locality while retries safely converge on the existing row.
  void eventId;
  void endpointId;
  return createUuidV7(now.getTime());
}

function readUuid(event: Readonly<OutboxEventRecord>, field: string): string {
  const value = event.payload.data[field];
  if (typeof value !== 'string' || !isUuidV7(value)) {
    throw new Error(`Outbox Event ${event.id} has an invalid ${field}.`);
  }
  return value;
}

function readPositiveInteger(event: Readonly<OutboxEventRecord>, field: string): number {
  const value = event.payload.data[field];
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Outbox Event ${event.id} has an invalid ${field}.`);
  }
  return Number(value);
}

function readDate(event: Readonly<OutboxEventRecord>, field: string): Date {
  const value = event.payload.data[field];
  const date = typeof value === 'string' ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Outbox Event ${event.id} has an invalid ${field}.`);
  }
  return date;
}
