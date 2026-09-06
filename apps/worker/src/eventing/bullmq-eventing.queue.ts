import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { parseRedisUrl, type WorkerEnvironment } from '@atlas/config';
import {
  OUTBOX_CONSUME_JOB_NAME,
  PUBLICATION_SCHEDULE_JOB_NAME,
  WEBHOOK_DELIVERY_JOB_NAME,
  type EnqueueOutboxEventInput,
  type EnqueuePublicationScheduleInput,
  type EnqueueWebhookDeliveryInput,
  type EventingQueuePort,
} from '@atlas/server';

@Injectable()
export class BullMqEventingQueue implements EventingQueuePort, OnApplicationShutdown {
  private readonly queue: Queue;

  public constructor(config: ConfigService<WorkerEnvironment, true>) {
    this.queue = new Queue(config.get('SYSTEM_QUEUE_NAME', { infer: true }), {
      connection: parseRedisUrl(config.get('REDIS_URL', { infer: true })),
    });
  }

  public async enqueueOutboxEvent(input: Readonly<EnqueueOutboxEventInput>): Promise<void> {
    const generation = input.notificationVersion;
    if (generation !== undefined && (!Number.isSafeInteger(generation) || generation < 1)) {
      throw new Error('Consumer notification version must be a positive integer.');
    }
    await this.queue.add(
      OUTBOX_CONSUME_JOB_NAME,
      {
        eventId: input.eventId,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      },
      // PostgreSQL owns retry budgeting. A hint may be duplicated or lost; it never
      // authorizes bypassing a receipt's due time, terminal status or attempt owner.
      queueOptions(generation === undefined ? input.eventId : `outbox-${input.eventId}-${generation}`, input.availableAt),
    );
  }

  public async enqueueWebhookDelivery(input: Readonly<EnqueueWebhookDeliveryInput>): Promise<void> {
    await this.queue.add(
      WEBHOOK_DELIVERY_JOB_NAME,
      {
        deliveryId: input.deliveryId,
        attemptNumber: input.attemptNumber,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      },
      queueOptions(`webhook-${input.deliveryId}-${input.attemptNumber}`, input.availableAt),
    );
  }

  public async enqueuePublicationSchedule(input: Readonly<EnqueuePublicationScheduleInput>): Promise<void> {
    await this.queue.add(
      PUBLICATION_SCHEDULE_JOB_NAME,
      {
        scheduleId: input.scheduleId,
        attemptNumber: input.attemptNumber,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      },
      queueOptions(`publication-${input.scheduleId}-${input.attemptNumber}`, input.availableAt),
    );
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}

function queueOptions(jobId: string, availableAt: Date) {
  return {
    jobId,
    delay: Math.max(0, availableAt.getTime() - Date.now()),
    attempts: 1,
    removeOnComplete: { age: 86_400, count: 5_000 },
    removeOnFail: { age: 604_800, count: 10_000 },
  } as const;
}
