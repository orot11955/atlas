import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { parseOriginList, type ApiEnvironment } from '@atlas/config';
import {
  ATLAS_LOGGER,
  AtlasLogLevel,
  type AtlasLogger,
} from '@atlas/server';

import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './filters/problem-details.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const config = app.get(ConfigService<ApiEnvironment, true>);
  const logger = app.get<AtlasLogger>(ATLAS_LOGGER);
  const port = config.get('PORT', { infer: true });

  app.useLogger(logger);
  app.flushLogs();
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  app.enableCors({
    credentials: true,
    origin: parseOriginList(config.get('CORS_ORIGINS', { infer: true })),
  });
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: {
        target: false,
        value: false,
      },
    }),
  );

  const openApiConfig = new DocumentBuilder()
    .setTitle('Atlas API')
    .setDescription('Atlas Admin, Delivery, Integration and Member API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port, '0.0.0.0');
  logger.write(
    AtlasLogLevel.INFO,
    {
      event: 'application.started',
      port,
    },
    'Atlas API started.',
  );
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
