import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import { OBJECT_STORAGE, type ObjectStoragePort } from '@atlas/object-storage';
import {
  AssetEntity,
  AssetUsageEntity,
  AssetVariantEntity,
  ContentDeliveryService,
  ContentDraftEntity,
  ContentEntity,
  ContentPublicationEntity,
  ContentPublicationService,
  ContentRevisionEntity,
  ContentService,
  ContentSiteEntity,
  TypeOrmContentAssetRepository,
  TypeOrmContentPublicationRepository,
  TypeOrmContentRepository,
  type AuditService,
  type ContentAssetRepositoryPort,
  type ContentPublicationRepositoryPort,
  type ContentRepositoryPort,
  type OutboxRecorderPort,
  systemClock,
  type TransactionRunner,
} from '@atlas/server';

import { AdminSessionModule } from '../admin-session/admin-session.module';
import { AdminWorkspaceSiteModule } from '../admin-sites/admin-workspace-site.module';
import { EventingPersistenceModule } from '../eventing/eventing-persistence.module';
import { OUTBOX_SERVICE } from '../eventing/eventing.tokens';
import { MinioModule } from '../infrastructure/minio/minio.module';
import { PlatformModule } from '../platform/platform.module';
import { AUDIT_SERVICE, TRANSACTION_RUNNER } from '../platform/platform.tokens';
import { ContentPublicationController } from './content-publication.controller';
import { ContentController } from './content.controller';
import {
  CONTENT_ASSET_REPOSITORY,
  CONTENT_DELIVERY_SERVICE,
  CONTENT_PUBLICATION_REPOSITORY,
  CONTENT_PUBLICATION_SERVICE,
  CONTENT_REPOSITORY,
  CONTENT_SERVICE,
} from './content.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ContentEntity,
      ContentDraftEntity,
      ContentRevisionEntity,
      AssetEntity,
      AssetUsageEntity,
      AssetVariantEntity,
      ContentSiteEntity,
      ContentPublicationEntity,
    ]),
    PlatformModule,
    EventingPersistenceModule,
    MinioModule,
    AdminSessionModule,
    AdminWorkspaceSiteModule,
  ],
  controllers: [ContentController, ContentPublicationController],
  providers: [
    {
      provide: CONTENT_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new TypeOrmContentRepository(dataSource),
    },
    {
      provide: CONTENT_ASSET_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new TypeOrmContentAssetRepository(dataSource),
    },
    {
      provide: CONTENT_SERVICE,
      inject: [TRANSACTION_RUNNER, CONTENT_REPOSITORY, AUDIT_SERVICE, CONTENT_ASSET_REPOSITORY],
      useFactory: (
        transactionRunner: TransactionRunner<EntityManager>,
        repository: ContentRepositoryPort<EntityManager>,
        auditService: AuditService<EntityManager>,
        assetRepository: ContentAssetRepositoryPort<EntityManager>,
      ) => new ContentService(transactionRunner, repository, auditService, assetRepository),
    },
    {
      provide: CONTENT_PUBLICATION_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new TypeOrmContentPublicationRepository(dataSource),
    },
    {
      provide: CONTENT_PUBLICATION_SERVICE,
      inject: [
        TRANSACTION_RUNNER,
        CONTENT_PUBLICATION_REPOSITORY,
        AUDIT_SERVICE,
        CONTENT_ASSET_REPOSITORY,
        OBJECT_STORAGE,
        OUTBOX_SERVICE,
      ],
      useFactory: (
        transactionRunner: TransactionRunner<EntityManager>,
        repository: ContentPublicationRepositoryPort<EntityManager>,
        auditService: AuditService<EntityManager>,
        assetRepository: ContentAssetRepositoryPort<EntityManager>,
        objectStorage: ObjectStoragePort,
        outboxService: OutboxRecorderPort<EntityManager>,
      ) =>
        new ContentPublicationService(
          transactionRunner,
          repository,
          auditService,
          assetRepository,
          objectStorage,
          systemClock,
          outboxService,
        ),
    },
    {
      provide: CONTENT_DELIVERY_SERVICE,
      inject: [CONTENT_PUBLICATION_REPOSITORY],
      useFactory: (repository: ContentPublicationRepositoryPort<EntityManager>) =>
        new ContentDeliveryService(repository),
    },
  ],
  exports: [CONTENT_SERVICE, CONTENT_PUBLICATION_SERVICE, CONTENT_DELIVERY_SERVICE],
})
export class ContentModule {}
