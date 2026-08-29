import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { workerEnvironmentSchema } from '@atlas/config';

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
  providers: [SystemQueueWorker],
})
export class WorkerModule {}
