import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, Worker } from 'bullmq';

import { parseRedisUrl, type WorkerEnvironment } from '@atlas/config';
import {
  ATLAS_LOGGER,
  ActorType,
  ApplicationError,
  AtlasLogLevel,
  ErrorCode,
  OUTBOX_CONSUME_JOB_NAME,
  PUBLICATION_SCHEDULE_JOB_NAME,
  WEBHOOK_DELIVERY_JOB_NAME,
  type AtlasLogger,
  type OutboxConsumerService,
  type PublicationScheduleProcessor,
  type WebhookDeliveryService,
  createUuidV7,
  isApplicationError,
  isUuidV7,
  requestContext,
  systemClock,
} from '@atlas/server';

import {
  WORKER_OUTBOX_CONSUMER_SERVICE,
  WORKER_PUBLICATION_SCHEDULE_PROCESSOR,
  WORKER_WEBHOOK_DELIVERY_SERVICE,
} from '../eventing/eventing.tokens';

@Injectable()
export class SystemQueueWorker implements OnModuleInit, OnApplicationShutdown {
  private worker?: Worker;
  private queueName?: string;

  public constructor(
    private readonly config: ConfigService<WorkerEnvironment, true>,
    @Inject(WORKER_OUTBOX_CONSUMER_SERVICE)
    private readonly outboxConsumer: OutboxConsumerService<unknown>,
    @Inject(WORKER_WEBHOOK_DELIVERY_SERVICE)
    private readonly webhookDelivery: WebhookDeliveryService<unknown>,
    @Inject(WORKER_PUBLICATION_SCHEDULE_PROCESSOR)
    private readonly publicationSchedule: PublicationScheduleProcessor<unknown>,
    @Inject(ATLAS_LOGGER) private readonly logger: AtlasLogger,
  ) {}

  public onModuleInit(): void {
    const queueName = this.config.get('SYSTEM_QUEUE_NAME', { infer: true });
    this.queueName = queueName;

    this.worker = new Worker(queueName, async (job: Job) => this.processJob(queueName, job), {
      connection: parseRedisUrl(this.config.get('REDIS_URL', { infer: true })),
      concurrency: this.config.get('EVENTING_QUEUE_CONCURRENCY', { infer: true }),
    });

    this.worker.on('ready', () => {
      this.logger.write(
        AtlasLogLevel.INFO,
        {
          event: 'worker.queue.ready',
          queueName,
        },
        'BullMQ worker is ready.',
      );
    });

    this.worker.on('error', (error) => {
      this.logger.write(
        AtlasLogLevel.ERROR,
        {
          event: 'worker.queue.error',
          queueName,
        },
        'BullMQ worker emitted an error.',
        error,
      );
    });
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.logger.write(
      AtlasLogLevel.INFO,
      {
        event: 'worker.queue.closed',
        ...(this.queueName ? { queueName: this.queueName } : {}),
      },
      'BullMQ worker closed.',
    );
  }

  private processJob(queueName: string, job: Job): Promise<unknown> {
    const requestId = createUuidV7();
    const jobId = String(job.id ?? requestId);
    const correlationId = getCorrelationId(job, jobId);

    return requestContext.run(
      {
        requestId,
        traceId: requestId,
        correlationId,
        actorType: ActorType.SYSTEM,
        actorId: `worker:${queueName}`,
      },
      async () => {
        const baseBindings = {
          queueName,
          jobId,
          jobName: job.name,
          attempt: job.attemptsMade + 1,
        };

        this.logger.write(
          AtlasLogLevel.DEBUG,
          {
            event: 'worker.job.started',
            ...baseBindings,
          },
          'BullMQ job started.',
        );

        try {
          const result = await this.routeJob(job, requestId);

          this.logger.write(
            AtlasLogLevel.DEBUG,
            {
              event: 'worker.job.completed',
              ...baseBindings,
            },
            'BullMQ job completed.',
          );

          return result;
        } catch (error) {
          const normalizedError =
            error instanceof Error ? error : new Error('Unknown worker job failure.');

          this.logger.write(
            AtlasLogLevel.ERROR,
            {
              event: 'worker.job.failed',
              ...baseBindings,
              ...(isApplicationError(error) ? { errorCode: error.code } : {}),
            },
            'BullMQ job failed.',
            normalizedError,
          );

          throw error;
        }
      },
    );
  }

  private async routeJob(job: Job, requestId: string): Promise<unknown> {
    switch (job.name) {
      case 'heartbeat':
        return {
          requestId,
          receivedAt: systemClock.now().toISOString(),
          payload: job.data,
        };
      case OUTBOX_CONSUME_JOB_NAME:
        return this.outboxConsumer.consume(readUuidJobField(job, 'eventId'));
      case WEBHOOK_DELIVERY_JOB_NAME:
        return this.webhookDelivery.deliver(
          readUuidJobField(job, 'deliveryId'),
          readPositiveIntegerJobField(job, 'attemptNumber'),
        );
      case PUBLICATION_SCHEDULE_JOB_NAME:
        return this.publicationSchedule.process(
          readUuidJobField(job, 'scheduleId'),
          readPositiveIntegerJobField(job, 'attemptNumber'),
        );
      default:
        throw new ApplicationError({
          code: ErrorCode.ACTION_NOT_ALLOWED,
          message: `Unsupported system job: ${job.name}`,
        });
    }
  }
}

function getCorrelationId(job: Job, fallback: string): string {
  if (typeof job.data !== 'object' || job.data === null) {
    return fallback;
  }

  const correlationId = (job.data as Record<string, unknown>).correlationId;

  return typeof correlationId === 'string' && correlationId.length > 0 ? correlationId : fallback;
}

export function readUuidJobField(job: Pick<Job, 'data' | 'name'>, field: string): string {
  const value = readJobField(job, field);

  if (typeof value !== 'string' || !isUuidV7(value)) {
    throw invalidJobData(job.name, field);
  }

  return value;
}

export function readPositiveIntegerJobField(
  job: Pick<Job, 'data' | 'name'>,
  field: string,
): number {
  const value = readJobField(job, field);

  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw invalidJobData(job.name, field);
  }

  return value;
}

function readJobField(job: Pick<Job, 'data' | 'name'>, field: string): unknown {
  if (typeof job.data !== 'object' || job.data === null) {
    throw invalidJobData(job.name, field);
  }

  return (job.data as Record<string, unknown>)[field];
}

function invalidJobData(jobName: string, field: string): ApplicationError {
  return new ApplicationError({
    code: ErrorCode.VALIDATION_FAILED,
    message: `System job ${jobName} has invalid ${field}.`,
  });
}
