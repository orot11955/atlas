import { Global, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import type { ApiEnvironment } from '@atlas/config';

@Injectable()
export class RedisClientService implements OnApplicationShutdown {
  public readonly client: Redis;

  public constructor(config: ConfigService<ApiEnvironment, true>) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
    });
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.client.quit();
  }
}

@Global()
@Module({
  providers: [RedisClientService],
  exports: [RedisClientService],
})
export class RedisModule {}
