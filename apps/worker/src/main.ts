import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import {
  ATLAS_LOGGER,
  AtlasLogLevel,
  type AtlasLogger,
} from '@atlas/server';

import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  const logger = application.get<AtlasLogger>(ATLAS_LOGGER);

  application.useLogger(logger);
  application.flushLogs();
  application.enableShutdownHooks();
  logger.write(
    AtlasLogLevel.INFO,
    { event: 'application.started' },
    'Atlas Worker started.',
  );
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
