import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { workerEnvironmentSchema, type WorkerEnvironment } from '@atlas/config';
import { ATLAS_LOGGER, createAtlasLogger } from '@atlas/server';

import { SystemQueueWorker } from './processors/system-queue.worker';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: (environment) => workerEnvironmentSchema.parse(environment),
    }),
  ],
  providers: [
    {
      provide: ATLAS_LOGGER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkerEnvironment, true>) =>
        createAtlasLogger({
          service: 'atlas-worker',
          environment: config.get('NODE_ENV', { infer: true }),
          level: config.get('LOG_LEVEL', { infer: true }),
        }),
    },
    SystemQueueWorker,
  ],
})
export class WorkerModule {}
