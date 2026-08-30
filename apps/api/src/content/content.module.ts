import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import {
  ContentDraftEntity,
  ContentEntity,
  ContentRevisionEntity,
  ContentService,
  TypeOrmContentRepository,
  type AuditService,
  type ContentRepositoryPort,
  type TransactionRunner,
} from '@atlas/server';

import { AdminSessionModule } from '../admin-session/admin-session.module';
import { AdminWorkspaceSiteModule } from '../admin-sites/admin-workspace-site.module';
import { PlatformModule } from '../platform/platform.module';
import { AUDIT_SERVICE, TRANSACTION_RUNNER } from '../platform/platform.tokens';
import { ContentController } from './content.controller';
import { CONTENT_REPOSITORY, CONTENT_SERVICE } from './content.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([ContentEntity, ContentDraftEntity, ContentRevisionEntity]),
    PlatformModule,
    AdminSessionModule,
    AdminWorkspaceSiteModule,
  ],
  controllers: [ContentController],
  providers: [
    {
      provide: CONTENT_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new TypeOrmContentRepository(dataSource),
    },
    {
      provide: CONTENT_SERVICE,
      inject: [TRANSACTION_RUNNER, CONTENT_REPOSITORY, AUDIT_SERVICE],
      useFactory: (
        transactionRunner: TransactionRunner<EntityManager>,
        repository: ContentRepositoryPort<EntityManager>,
        auditService: AuditService<EntityManager>,
      ) => new ContentService(transactionRunner, repository, auditService),
    },
  ],
  exports: [CONTENT_SERVICE],
})
export class ContentModule {}
