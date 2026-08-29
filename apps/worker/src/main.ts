import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });

  application.enableShutdownHooks();
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
