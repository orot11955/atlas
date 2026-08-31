import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import type { ApiEnvironment } from '@atlas/config';
import { OBJECT_STORAGE, type ObjectStoragePort } from '@atlas/object-storage';
import {
  AssetEntity,
  AssetService,
  AssetUploadCoordinator,
  AssetUploadSessionEntity,
  TypeOrmAssetRepository,
  type AssetProcessingQueuePort,
  type AssetRepositoryPort,
  type AuditService,
  type TransactionRunner,
} from '@atlas/server';

import { AdminSessionModule } from '../admin-session/admin-session.module';
import { AdminWorkspaceSiteModule } from '../admin-sites/admin-workspace-site.module';
import { MinioModule } from '../infrastructure/minio/minio.module';
import { PlatformModule } from '../platform/platform.module';
import { AUDIT_SERVICE, TRANSACTION_RUNNER } from '../platform/platform.tokens';
import { BullMqAssetProcessingQueue } from './bullmq-asset-processing.queue';
import { MediaController } from './media.controller';
import {
  ASSET_PROCESSING_QUEUE,
  ASSET_REPOSITORY,
  ASSET_SERVICE,
  ASSET_UPLOAD_COORDINATOR,
} from './media.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([AssetEntity, AssetUploadSessionEntity]),
    PlatformModule,
    AdminSessionModule,
    AdminWorkspaceSiteModule,
    MinioModule,
  ],
  controllers: [MediaController],
  providers: [
    {
      provide: ASSET_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new TypeOrmAssetRepository(dataSource),
    },
    {
      provide: ASSET_PROCESSING_QUEUE,
      useClass: BullMqAssetProcessingQueue,
    },
    {
      provide: ASSET_SERVICE,
      inject: [TRANSACTION_RUNNER, ASSET_REPOSITORY, OBJECT_STORAGE, AUDIT_SERVICE, ConfigService],
      useFactory: (
        transactionRunner: TransactionRunner<EntityManager>,
        repository: AssetRepositoryPort<EntityManager>,
        objectStorage: ObjectStoragePort,
        auditService: AuditService<EntityManager>,
        config: ConfigService<ApiEnvironment, true>,
      ) =>
        new AssetService(transactionRunner, repository, objectStorage, auditService, {
          privateBucket: config.get('MINIO_PRIVATE_BUCKET', { infer: true }),
          uploadTtlSeconds: readIntegerEnvironment('ASSET_UPLOAD_TTL_SECONDS', 900, 60, 3_600),
          maximumUploadBytes: readIntegerEnvironment(
            'ASSET_UPLOAD_MAX_BYTES',
            26_214_400,
            1,
            26_214_400,
          ),
        }),
    },
    {
      provide: ASSET_UPLOAD_COORDINATOR,
      inject: [ASSET_SERVICE, ASSET_PROCESSING_QUEUE],
      useFactory: (
        assetService: AssetService<EntityManager>,
        processingQueue: AssetProcessingQueuePort,
      ) => new AssetUploadCoordinator(assetService, processingQueue),
    },
  ],
  exports: [ASSET_SERVICE, ASSET_UPLOAD_COORDINATOR],
})
export class MediaModule {}

function readIntegerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }

  return value;
}
