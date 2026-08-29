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
  type AtlasLogger,
  createUuidV7,
  isApplicationError,
  requestContext,
  systemClock,
} from '@atlas/server';

@Injectable()
export class SystemQueueWorker implements OnModuleInit, OnApplicationShutdown {
  private worker?: Worker;
  private queueName?: string;

  public constructor(
    private readonly config: ConfigService<WorkerEnvironment, true>,
    @Inject(ATLAS_LOGGER) private readonly logger: AtlasLogger,
  ) {}

  public onModuleInit(): void {
    const queueName = this.config.get('SYSTEM_QUEUE_NAME', { infer: true });
    this.queueName = queueName;

    this.worker = new Worker(queueName, async (job: Job) => this.processJob(queueName, job), {
      connection: parseRedisUrl(this.config.get('REDIS_URL', { infer: true })),
      concurrency: 2,
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
          if (job.name !== 'heartbeat') {
            throw new ApplicationError({
              code: ErrorCode.ACTION_NOT_ALLOWED,
              message: `Unsupported system job: ${job.name}`,
            });
          }

          const result = {
            requestId,
            receivedAt: systemClock.now().toISOString(),
            payload: job.data,
          };

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
}

function getCorrelationId(job: Job, fallback: string): string {
  if (typeof job.data !== 'object' || job.data === null) {
    return fallback;
  }

  const correlationId = (job.data as Record<string, unknown>).correlationId;

  return typeof correlationId === 'string' && correlationId.length > 0 ? correlationId : fallback;
}
