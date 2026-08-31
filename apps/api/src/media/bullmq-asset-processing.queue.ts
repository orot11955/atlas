import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { parseRedisUrl, type ApiEnvironment } from '@atlas/config';
import {
  MEDIA_PROCESS_JOB_NAME,
  type AssetProcessingJobData,
  type AssetProcessingQueuePort,
  type EnqueueAssetProcessingInput,
} from '@atlas/server';

@Injectable()
export class BullMqAssetProcessingQueue implements AssetProcessingQueuePort, OnApplicationShutdown {
  private readonly queue: Queue<AssetProcessingJobData>;

  public constructor(config: ConfigService<ApiEnvironment, true>) {
    this.queue = new Queue<AssetProcessingJobData>(
      config.get('MEDIA_QUEUE_NAME', { infer: true }),
      {
        connection: parseRedisUrl(config.get('REDIS_URL', { infer: true })),
      },
    );
  }

  public async enqueue(input: Readonly<EnqueueAssetProcessingInput>): Promise<void> {
    await this.queue.add(
      MEDIA_PROCESS_JOB_NAME,
      {
        workspaceId: input.workspaceId,
        assetId: input.assetId,
        assetVersion: input.assetVersion,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      },
      {
        jobId: `${input.assetId}-${input.assetVersion}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2_000,
        },
        removeOnComplete: {
          age: 86_400,
          count: 1_000,
        },
        removeOnFail: {
          age: 604_800,
          count: 5_000,
        },
      },
    );
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
