import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import {
  SiteDomainEntity,
  SiteEntity,
  SiteService,
  SiteSettingsEntity,
  TypeOrmSiteRepository,
  TypeOrmWorkspaceRepository,
  WorkspaceEntity,
  WorkspaceService,
  type AuditService,
  type SiteRepositoryPort,
  type TransactionRunner,
  type WorkspaceRepositoryPort,
} from '@atlas/server';

import { AdminSessionModule } from '../admin-session/admin-session.module';
import { PlatformModule } from '../platform/platform.module';
import { AUDIT_SERVICE, TRANSACTION_RUNNER } from '../platform/platform.tokens';
import { AdminSiteController } from './admin-site.controller';
import { AdminWorkspaceController } from './admin-workspace.controller';
import { AdminWorkspaceGuard } from './admin-workspace.guard';
import {
  SITE_REPOSITORY,
  SITE_SERVICE,
  WORKSPACE_REPOSITORY,
  WORKSPACE_SERVICE,
} from './admin-workspace-site.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkspaceEntity, SiteEntity, SiteDomainEntity, SiteSettingsEntity]),
    PlatformModule,
    AdminSessionModule,
  ],
  controllers: [AdminWorkspaceController, AdminSiteController],
  providers: [
    {
      provide: WORKSPACE_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new TypeOrmWorkspaceRepository(dataSource),
    },
    {
      provide: SITE_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new TypeOrmSiteRepository(dataSource),
    },
    {
      provide: WORKSPACE_SERVICE,
      inject: [TRANSACTION_RUNNER, WORKSPACE_REPOSITORY, AUDIT_SERVICE],
      useFactory: (
        transactionRunner: TransactionRunner<EntityManager>,
        repository: WorkspaceRepositoryPort<EntityManager>,
        auditService: AuditService<EntityManager>,
      ) => new WorkspaceService(transactionRunner, repository, auditService),
    },
    {
      provide: SITE_SERVICE,
      inject: [TRANSACTION_RUNNER, SITE_REPOSITORY, AUDIT_SERVICE],
      useFactory: (
        transactionRunner: TransactionRunner<EntityManager>,
        repository: SiteRepositoryPort<EntityManager>,
        auditService: AuditService<EntityManager>,
      ) => new SiteService(transactionRunner, repository, auditService),
    },
    AdminWorkspaceGuard,
  ],
  exports: [WORKSPACE_SERVICE, SITE_SERVICE, AdminWorkspaceGuard],
})
export class AdminWorkspaceSiteModule {}
