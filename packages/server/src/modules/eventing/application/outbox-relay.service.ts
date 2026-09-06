import { EventContractError, resolveEventContract } from '../domain/event-contract';
import type { AuditService, Clock, TransactionRunner } from '../../../core';
import {
  ActorType,
  AuditResult,
  DomainError,
  ErrorCode,
  createUuidV7,
  requestContext,
  systemClock,
} from '../../../core';
import {
  OutboxEventStatus,
  WebhookDeliveryStatus,
  truncateOperationalMessage,
  type OutboxEventRecord,
} from '../domain/eventing';
import type { EventingQueuePort } from '../ports/eventing-queue.port';
import type {
  EventConsumptionOwner,
  EventingRepositoryPort,
  OutboxAttemptOwner,
} from '../ports/eventing.repository';

const OUTBOX_RETRY_DELAYS_MS = Object.freeze([5_000, 30_000, 120_000, 600_000, 3_600_000]);
export const EVENTING_CONSUMER_KEY = 'atlas.eventing.v1';

type QueueNotification =
  | { kind: 'webhook'; input: Parameters<EventingQueuePort['enqueueWebhookDelivery']>[0] }
  | { kind: 'schedule'; input: Parameters<EventingQueuePort['enqueuePublicationSchedule']>[0] };
interface ConsumptionPlan {
  effects: number;
  notifications: readonly QueueNotification[];
}

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
      const owner = outboxOwner(event);
      try {
        await this.queue.enqueueOutboxEvent({
          eventId: event.id,
          availableAt: event.availableAt,
          correlationId: event.id,
        });
        const dispatchedAt = this.clock.now();
        await this.transactionRunner.run((transaction) =>
          this.repository.markOutboxEventDispatched(owner, dispatchedAt, transaction),
        );
      } catch (error) {
        await this.handleFailure(event, owner, error);
      }
    }
    return events.length;
  }

  public async recoverDueWork(): Promise<{ schedules: number; deliveries: number }> {
    const now = this.clock.now();
    const publicationStaleBefore = new Date(now.getTime() - this.options.publicationStaleMilliseconds);
    const webhookStaleBefore = new Date(now.getTime() - this.options.webhookStaleMilliseconds);
    await this.transactionRunner.run(async (transaction) => {
      await this.repository.recoverStalePublicationSchedules(publicationStaleBefore, now, transaction);
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

  private async handleFailure(
    event: Readonly<OutboxEventRecord>,
    owner: Readonly<OutboxAttemptOwner>,
    error: unknown,
  ): Promise<void> {
    const failedAt = this.clock.now();
    const delay =
      OUTBOX_RETRY_DELAYS_MS[Math.min(event.attemptCount - 1, OUTBOX_RETRY_DELAYS_MS.length - 1)] ??
      3_600_000;
    const terminal = event.attemptCount >= this.options.maximumAttempts;
    await this.transactionRunner.run((transaction) =>
      this.repository.rescheduleOutboxEvent(
        owner,
        terminal ? failedAt : new Date(failedAt.getTime() + delay),
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
    if (!event)
      throw new DomainError({ code: ErrorCode.NOT_FOUND, message: 'Outbox Event was not found.' });
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
    const consumption = await this.transactionRunner.run((transaction) =>
      this.repository.claimEventConsumption(
        event.id,
        EVENTING_CONSUMER_KEY,
        now,
        new Date(now.getTime() - this.options.staleMilliseconds),
        transaction,
      ),
    );
    if (!consumption) return Object.freeze({ duplicate: true, effects: 0 });
    const owner: Readonly<EventConsumptionOwner> = Object.freeze({
      consumptionId: consumption.id,
      eventId: consumption.eventId,
      consumerKey: consumption.consumerKey,
      workspaceId: event.workspaceId,
      attemptNumber: consumption.attemptCount,
    });
    let plan: ConsumptionPlan | undefined;
    try {
      plan = await this.transactionRunner.run(async (transaction) => {
        if (!(await this.repository.lockEventConsumption(owner, transaction))) return undefined;
        // All durable effects, receipt completion and Audit share the claimed row's lock.
        // No HTTP or Redis call is performed while this transaction is open.
        const prepared = await this.route(event, transaction);
        const applied = await this.repository.completeEventConsumption(
          owner,
          'succeeded',
          { processedAt: this.clock.now(), result: { effects: prepared.effects } },
          transaction,
        );
        if (!applied) throw new Error('Locked Event consumption ownership changed unexpectedly.');
        await this.auditService.record(
          {
            action: 'outbox.event-consumed',
            targetType: 'outbox-event',
            targetId: event.id,
            result: AuditResult.SUCCESS,
            metadata: { eventType: event.eventType, effects: prepared.effects },
          },
          transaction,
        );
        return prepared;
      });
    } catch (error) {
      await this.transactionRunner.run(async (transaction) => {
        const applied = await this.repository.completeEventConsumption(
          owner,
          'failed',
          { processedAt: this.clock.now(), errorMessage: truncateOperationalMessage(error) },
          transaction,
        );
        if (!applied) return;
        await this.auditService.record(
          {
            action: 'outbox.event-consumption-failed',
            targetType: 'outbox-event',
            targetId: event.id,
            result: AuditResult.FAILURE,
            errorCode: error instanceof EventContractError ? error.code : ErrorCode.INTERNAL_ERROR,
            metadata: error instanceof EventContractError
              ? { contractReason: error.reason }
              : { eventType: event.eventType },
          },
          transaction,
        );
      });
      throw error;
    }
    if (!plan) return Object.freeze({ duplicate: true, effects: 0 });
    // Queue errors cannot roll back committed effects or reclassify a succeeded receipt.
    // Relay rediscovers pending deliveries/schedules after queue failure or process death.
    for (const notification of plan.notifications) {
      if (notification.kind === 'webhook')
        await this.queue.enqueueWebhookDelivery(notification.input);
      else await this.queue.enqueuePublicationSchedule(notification.input);
    }
    return Object.freeze({ duplicate: false, effects: plan.effects });
  }

  private async route(
    event: Readonly<OutboxEventRecord>,
    transaction: TTransaction,
  ): Promise<ConsumptionPlan> {
    const route = resolveEventContract(event);
    if (route.kind === 'publication') {
      const endpoints = await this.repository.listActiveWebhookEndpointsForEvent(
        event.workspaceId,
        route.siteId,
        route.eventType,
        event.createdAt,
        transaction,
      );
      const notifications: QueueNotification[] = [];
      for (const endpoint of endpoints) {
        const createdAt = this.clock.now();
        const delivery = await this.repository.insertWebhookDeliveryIfAbsent(
          {
            id: createUuidV7(createdAt.getTime()),
            workspaceId: event.workspaceId,
            endpointId: endpoint.id,
            eventId: event.id,
            eventType: event.eventType,
            createdAt,
          },
          transaction,
        );
        if (
          delivery.status === WebhookDeliveryStatus.PENDING ||
          delivery.status === WebhookDeliveryStatus.RETRY_SCHEDULED
        ) {
          notifications.push({
            kind: 'webhook',
            input: {
              deliveryId: delivery.id,
              attemptNumber: delivery.attemptCount + 1,
              availableAt: delivery.nextRetryAt ?? createdAt,
              correlationId: event.id,
            },
          });
        }
      }
      return { effects: endpoints.length, notifications };
    }
    if (route.kind === 'schedule') {
      return {
        effects: 1,
        notifications: [
          {
            kind: 'schedule',
            input: {
              scheduleId: route.scheduleId,
              attemptNumber: route.attemptNumber,
              availableAt: route.availableAt,
              correlationId: event.id,
            },
          },
        ],
      };
    }
    if (route.kind === 'webhook-retry') {
      return {
        effects: 1,
        notifications: [
          {
            kind: 'webhook',
            input: {
              deliveryId: route.deliveryId,
              attemptNumber: route.attemptNumber,
              availableAt: route.availableAt,
              correlationId: event.id,
            },
          },
        ],
      };
    }
    const unreachable: never = route;
    throw new Error(`Unreachable registered Event route: ${String(unreachable)}`);
  }
}

function outboxOwner(event: Readonly<OutboxEventRecord>): Readonly<OutboxAttemptOwner> {
  return Object.freeze({
    eventId: event.id,
    workspaceId: event.workspaceId,
    attemptNumber: event.attemptCount,
  });
}

