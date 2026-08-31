import { createHash } from 'node:crypto';

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
  MEDIA_PROCESS_JOB_NAME,
  createUuidV7,
  isApplicationError,
  requestContext,
  type AssetProcessingJobData,
  type AssetProcessingService,
  type AtlasLogger,
} from '@atlas/server';

import { WorkerDatabaseService } from '../infrastructure/worker-database.service';
import { ASSET_PROCESSING_SERVICE } from './media.tokens';

@Injectable()
export class MediaQueueWorker implements OnModuleInit, OnApplicationShutdown {
  private worker?: Worker<AssetProcessingJobData>;
  private queueName?: string;

  public constructor(
    private readonly config: ConfigService<WorkerEnvironment, true>,
    private readonly database: WorkerDatabaseService,
    @Inject(ASSET_PROCESSING_SERVICE)
    private readonly processingService: AssetProcessingService<unknown>,
    @Inject(ATLAS_LOGGER) private readonly logger: AtlasLogger,
  ) {}

  public async onModuleInit(): Promise<void> {
    await this.database.ready();
    const queueName = this.config.get('MEDIA_QUEUE_NAME', { infer: true });
    this.queueName = queueName;
    this.worker = new Worker<AssetProcessingJobData>(
      queueName,
      async (job) => this.processJob(queueName, job),
      {
        connection: parseRedisUrl(this.config.get('REDIS_URL', { infer: true })),
        concurrency: this.config.get('MEDIA_PROCESSING_CONCURRENCY', { infer: true }),
      },
    );

    this.worker.on('ready', () => {
      this.logger.write(
        AtlasLogLevel.INFO,
        { event: 'worker.media-queue.ready', queueName },
        'Media BullMQ worker is ready.',
      );
    });
    this.worker.on('error', (error) => {
      this.logger.write(
        AtlasLogLevel.ERROR,
        { event: 'worker.media-queue.error', queueName },
        'Media BullMQ worker emitted an error.',
        error,
      );
    });
    this.worker.on('failed', (job, error) => {
      this.logger.write(
        AtlasLogLevel.ERROR,
        {
          event: 'worker.media-job.exhausted',
          queueName,
          jobId: String(job?.id ?? 'unknown'),
          jobName: job?.name ?? MEDIA_PROCESS_JOB_NAME,
        },
        'Media BullMQ job failed.',
        error,
      );
    });
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.logger.write(
      AtlasLogLevel.INFO,
      {
        event: 'worker.media-queue.closed',
        ...(this.queueName ? { queueName: this.queueName } : {}),
      },
      'Media BullMQ worker closed.',
    );
  }

  private processJob(queueName: string, job: Job<AssetProcessingJobData>): Promise<unknown> {
    if (job.name !== MEDIA_PROCESS_JOB_NAME) {
      throw new ApplicationError({
        code: ErrorCode.ACTION_NOT_ALLOWED,
        message: `Unsupported Media job: ${job.name}`,
      });
    }

    const data = requireJobData(job.data);
    const requestId = createUuidV7();
    const jobId = normalizeJobId(job.id ?? requestId);
    const correlationId = data.correlationId ?? jobId;
    const maximumAttempts = Math.max(1, job.opts.attempts ?? 1);
    const currentAttempt = job.attemptsMade + 1;

    return requestContext.run(
      {
        requestId,
        traceId: requestId,
        correlationId,
        actorType: ActorType.SYSTEM,
        actorId: `worker:${queueName}`,
        workspaceId: data.workspaceId,
      },
      async () => {
        const bindings = {
          queueName,
          jobId,
          jobName: job.name,
          assetId: data.assetId,
          assetVersion: data.assetVersion,
          attempt: currentAttempt,
          maximumAttempts,
        };

        this.logger.write(
          AtlasLogLevel.INFO,
          { event: 'worker.media-job.started', ...bindings },
          'Media Asset processing started.',
        );

        try {
          const result = await this.processingService.process({
            workspaceId: data.workspaceId,
            assetId: data.assetId,
            jobId,
            finalAttempt: currentAttempt >= maximumAttempts,
          });
          const safeResult = {
            kind: result.kind,
            assetId: data.assetId,
            variantCount: 'variants' in result ? result.variants.length : 0,
          };

          this.logger.write(
            AtlasLogLevel.INFO,
            { event: 'worker.media-job.completed', ...bindings, result: result.kind },
            'Media Asset processing completed.',
          );

          return safeResult;
        } catch (error) {
          const normalizedError =
            error instanceof Error ? error : new Error('Unknown Media processing failure.');

          this.logger.write(
            AtlasLogLevel.ERROR,
            {
              event: 'worker.media-job.failed',
              ...bindings,
              ...(isApplicationError(error) ? { errorCode: error.code } : {}),
            },
            'Media Asset processing failed.',
            normalizedError,
          );

          throw error;
        }
      },
    );
  }
}

function requireJobData(value: AssetProcessingJobData): AssetProcessingJobData {
  if (
    !value ||
    !isUuidV7(value.workspaceId) ||
    !isUuidV7(value.assetId) ||
    !Number.isSafeInteger(value.assetVersion) ||
    value.assetVersion < 1 ||
    (value.correlationId !== undefined &&
      (value.correlationId.length < 1 || value.correlationId.length > 128))
  ) {
    throw new ApplicationError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Media Asset processing Job payload is invalid.',
    });
  }

  return value;
}

function normalizeJobId(value: string | number): string {
  const normalized = String(value);

  return normalized.length <= 128
    ? normalized
    : createHash('sha256').update(normalized).digest('hex');
}

function isUuidV7(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
