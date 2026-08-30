import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import {
  DeploymentCallbackService,
  DeploymentEntity,
  DeploymentEventEntity,
  EnvironmentEntity,
  HealthCheckEntity,
  IdempotencyRecordEntity,
  ProjectDeploymentAdministrationService,
  ProjectEntity,
  ProjectEventEntity,
  ProjectSiteEntity,
  ReleaseEntity,
  RepositoryConnectionEntity,
  ServiceEntity,
  ServiceEnvironmentEntity,
  TypeOrmProjectDeploymentRepository,
  type AuditService,
  type ProjectDeploymentRepositoryPort,
  type TransactionRunner,
} from '@atlas/server';

import { AdminSessionModule } from '../admin-session/admin-session.module';
import { AdminWorkspaceSiteModule } from '../admin-sites/admin-workspace-site.module';
import { ApiClientModule } from '../api-clients/api-client.module';
import { PlatformModule } from '../platform/platform.module';
import { AUDIT_SERVICE, TRANSACTION_RUNNER } from '../platform/platform.tokens';
import { AdminProjectDeploymentController } from './admin-project-deployment.controller';
import { IntegrationDeploymentController } from './integration-deployment.controller';
import {
  DEPLOYMENT_CALLBACK_SERVICE,
  PROJECT_DEPLOYMENT_ADMINISTRATION_SERVICE,
  PROJECT_DEPLOYMENT_REPOSITORY,
} from './project-deployment.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectEntity,
      ProjectSiteEntity,
      ProjectEventEntity,
      RepositoryConnectionEntity,
      ReleaseEntity,
      EnvironmentEntity,
      ServiceEntity,
      ServiceEnvironmentEntity,
      DeploymentEntity,
      DeploymentEventEntity,
      HealthCheckEntity,
      IdempotencyRecordEntity,
    ]),
    PlatformModule,
    AdminSessionModule,
    AdminWorkspaceSiteModule,
    ApiClientModule,
  ],
  controllers: [AdminProjectDeploymentController, IntegrationDeploymentController],
  providers: [
    {
      provide: PROJECT_DEPLOYMENT_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new TypeOrmProjectDeploymentRepository(dataSource),
    },
    {
      provide: PROJECT_DEPLOYMENT_ADMINISTRATION_SERVICE,
      inject: [TRANSACTION_RUNNER, PROJECT_DEPLOYMENT_REPOSITORY, AUDIT_SERVICE],
      useFactory: (
        transactionRunner: TransactionRunner<EntityManager>,
        repository: ProjectDeploymentRepositoryPort<EntityManager>,
        auditService: AuditService<EntityManager>,
      ) => new ProjectDeploymentAdministrationService(transactionRunner, repository, auditService),
    },
    {
      provide: DEPLOYMENT_CALLBACK_SERVICE,
      inject: [TRANSACTION_RUNNER, PROJECT_DEPLOYMENT_REPOSITORY, AUDIT_SERVICE],
      useFactory: (
        transactionRunner: TransactionRunner<EntityManager>,
        repository: ProjectDeploymentRepositoryPort<EntityManager>,
        auditService: AuditService<EntityManager>,
      ) => new DeploymentCallbackService(transactionRunner, repository, auditService),
    },
  ],
})
export class ProjectDeploymentModule {}
