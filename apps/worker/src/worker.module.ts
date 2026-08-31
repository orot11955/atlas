import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Client } from 'minio';

import { workerEnvironmentSchema, type WorkerEnvironment } from '@atlas/config';
import {
  MinioObjectStorageAdapter,
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '@atlas/object-storage';
import {
  ATLAS_LOGGER,
  AssetProcessingService,
  AuditService,
  TypeOrmAssetProcessingRepository,
  TypeOrmAuditRepository,
  TypeOrmTransactionRunner,
  createAtlasLogger,
} from '@atlas/server';

import { WorkerDatabaseService } from './infrastructure/worker-database.service';
import { MediaQueueWorker } from './media/media-queue.worker';
import { ASSET_PROCESSING_SERVICE } from './media/media.tokens';
import { SharpAssetImageProcessor } from './media/sharp-asset-image.processor';
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
    WorkerDatabaseService,
    {
      provide: OBJECT_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkerEnvironment, true>) => {
        const endpoint = new URL(config.get('MINIO_ENDPOINT', { infer: true }));
        const client = new Client({
          endPoint: endpoint.hostname,
          port: endpoint.port ? Number(endpoint.port) : endpoint.protocol === 'https:' ? 443 : 9000,
          useSSL: endpoint.protocol === 'https:',
          accessKey: config.get('MINIO_ACCESS_KEY', { infer: true }),
          secretKey: config.get('MINIO_SECRET_KEY', { infer: true }),
        });

        return new MinioObjectStorageAdapter(
          client,
          config.get('MINIO_PUBLIC_BASE_URL', { infer: true }),
        );
      },
    },
    SharpAssetImageProcessor,
    {
      provide: ASSET_PROCESSING_SERVICE,
      inject: [WorkerDatabaseService, OBJECT_STORAGE, SharpAssetImageProcessor, ConfigService],
      useFactory: (
        database: WorkerDatabaseService,
        objectStorage: ObjectStoragePort,
        imageProcessor: SharpAssetImageProcessor,
        config: ConfigService<WorkerEnvironment, true>,
      ) =>
        new AssetProcessingService(
          new TypeOrmTransactionRunner(database.dataSource),
          new TypeOrmAssetProcessingRepository(database.dataSource),
          objectStorage,
          imageProcessor,
          new AuditService(new TypeOrmAuditRepository(database.dataSource)),
          {
            privateBucket: config.get('MINIO_PRIVATE_BUCKET', { infer: true }),
            processingBucket: config.get('MINIO_PROCESSING_BUCKET', { infer: true }),
            publicBucket: config.get('MINIO_PUBLIC_BUCKET', { infer: true }),
            maximumInputBytes: config.get('ASSET_PROCESSING_MAX_INPUT_BYTES', { infer: true }),
            maximumOutputBytes: config.get('ASSET_PROCESSING_MAX_OUTPUT_BYTES', {
              infer: true,
            }),
            maximumPixels: config.get('ASSET_PROCESSING_MAX_PIXELS', { infer: true }),
            maximumDimension: config.get('ASSET_PROCESSING_MAX_DIMENSION', { infer: true }),
            staleSeconds: config.get('ASSET_PROCESSING_STALE_SECONDS', { infer: true }),
          },
        ),
    },
    SystemQueueWorker,
    MediaQueueWorker,
  ],
})
export class WorkerModule {}
