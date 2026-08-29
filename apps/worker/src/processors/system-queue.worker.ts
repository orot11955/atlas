import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, Worker } from 'bullmq';

import {
  parseRedisUrl,
  type WorkerEnvironment,
} from '@atlas/config';

@Injectable()
export class SystemQueueWorker
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(SystemQueueWorker.name);
  private worker?: Worker;

  public constructor(
    private readonly config: ConfigService<WorkerEnvironment, true>,
  ) {}

  public onModuleInit(): void {
    const queueName = this.config.get('SYSTEM_QUEUE_NAME', { infer: true });

    this.worker = new Worker(
      queueName,
      async (job: Job) => {
        if (job.name !== 'heartbeat') {
          throw new Error(`Unsupported system job: ${job.name}`);
        }

        return {
          receivedAt: new Date().toISOString(),
          payload: job.data,
        };
      },
      {
        connection: parseRedisUrl(
          this.config.get('REDIS_URL', { infer: true }),
        ),
        concurrency: 2,
      },
    );

    this.worker.on('ready', () => {
      this.logger.log(`Listening on BullMQ queue "${queueName}".`);
    });

    this.worker.on('completed', (job) => {
      this.logger.debug(`Completed job ${job.id ?? 'unknown'}.`);
    });

    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Failed job ${job?.id ?? 'unknown'}: ${error.message}`,
        error.stack,
      );
    });
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
