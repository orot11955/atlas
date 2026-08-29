import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import type { ApiEnvironment } from '@atlas/config';
import { OBJECT_STORAGE, type ObjectStoragePort } from '@atlas/object-storage';

import { RedisClientService } from '../infrastructure/redis/redis.module';

type CheckResult = {
  status: 'up' | 'down';
  message?: string;
};

export type ReadyResult = {
  status: 'up' | 'down';
  checks: Record<string, CheckResult>;
  timestamp: string;
};

@Injectable()
export class HealthService {
  public constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisClientService,
    private readonly config: ConfigService<ApiEnvironment, true>,
    @Inject(OBJECT_STORAGE)
    private readonly objectStorage: ObjectStoragePort,
  ) {}

  public async ready(): Promise<ReadyResult> {
    const privateBucket = this.config.get('MINIO_PRIVATE_BUCKET', {
      infer: true,
    });

    const checks = Object.fromEntries(
      await Promise.all([
        this.check('postgres', async () => {
          await this.dataSource.query('SELECT 1');
        }),
        this.check('redis', async () => {
          await this.redis.client.ping();
        }),
        this.check('minio', async () => {
          const exists = await this.objectStorage.bucketExists(privateBucket);

          if (!exists) {
            throw new Error(`Bucket ${privateBucket} does not exist.`);
          }
        }),
      ]),
    );

    const result: ReadyResult = {
      status: Object.values(checks).every((check) => check.status === 'up') ? 'up' : 'down',
      checks,
      timestamp: new Date().toISOString(),
    };

    if (result.status === 'down') {
      throw new ServiceUnavailableException(result);
    }

    return result;
  }

  private async check(
    name: string,
    operation: () => Promise<void>,
  ): Promise<[string, CheckResult]> {
    try {
      await operation();
      return [name, { status: 'up' }];
    } catch (error: unknown) {
      return [
        name,
        {
          status: 'down',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      ];
    }
  }
}
