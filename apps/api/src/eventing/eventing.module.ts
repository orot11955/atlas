import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';

import type { ApiEnvironment } from '@atlas/config';
import {
  OutboxAdministrationService,
  PublicationSchedulingService,
  WebhookAdministrationService,
  type AuditService,
  type EventingRepositoryPort,
  type OutboxService,
  type TransactionRunner,
  type WebhookSecretCipherPort,
  type WebhookSecretGeneratorPort,
} from '@atlas/server';

import { AdminSessionModule } from '../admin-session/admin-session.module';
import { AdminWorkspaceSiteModule } from '../admin-sites/admin-workspace-site.module';
import { PlatformModule } from '../platform/platform.module';
import { AUDIT_SERVICE, TRANSACTION_RUNNER } from '../platform/platform.tokens';
import { EventingController } from './eventing.controller';
import { EventingPersistenceModule } from './eventing-persistence.module';
import {
  EVENTING_REPOSITORY,
  OUTBOX_ADMINISTRATION_SERVICE,
  OUTBOX_SERVICE,
  PUBLICATION_SCHEDULING_SERVICE,
  WEBHOOK_ADMINISTRATION_SERVICE,
  WEBHOOK_SECRET_CIPHER,
  WEBHOOK_SECRET_GENERATOR,
} from './eventing.tokens';

@Module({
  imports: [
    EventingPersistenceModule,
    PlatformModule,
    AdminSessionModule,
    AdminWorkspaceSiteModule,
  ],
  controllers: [EventingController],
  providers: [
    {
      provide: OUTBOX_ADMINISTRATION_SERVICE,
      inject: [TRANSACTION_RUNNER, EVENTING_REPOSITORY, AUDIT_SERVICE],
      useFactory: (
        transactionRunner: TransactionRunner<EntityManager>,
        repository: EventingRepositoryPort<EntityManager>,
        auditService: AuditService<EntityManager>,
      ) => new OutboxAdministrationService(transactionRunner, repository, auditService),
    },
    {
      provide: WEBHOOK_ADMINISTRATION_SERVICE,
      inject: [
        TRANSACTION_RUNNER,
        EVENTING_REPOSITORY,
        AUDIT_SERVICE,
        OUTBOX_SERVICE,
        WEBHOOK_SECRET_GENERATOR,
        WEBHOOK_SECRET_CIPHER,
        ConfigService,
      ],
      useFactory: (
        transactionRunner: TransactionRunner<EntityManager>,
        repository: EventingRepositoryPort<EntityManager>,
        auditService: AuditService<EntityManager>,
        outboxService: OutboxService<EntityManager>,
        secretGenerator: WebhookSecretGeneratorPort,
        secretCipher: WebhookSecretCipherPort,
        config: ConfigService<ApiEnvironment, true>,
      ) =>
        new WebhookAdministrationService(
          transactionRunner,
          repository,
          auditService,
          outboxService,
          secretGenerator,
          secretCipher,
          {
            allowHttp:
              config.get('NODE_ENV', { infer: true }) !== 'production' &&
              config.get('WEBHOOK_ALLOW_HTTP', { infer: true }),
            allowPrivateNetwork:
              config.get('NODE_ENV', { infer: true }) !== 'production' &&
              config.get('WEBHOOK_ALLOW_PRIVATE_NETWORK', { infer: true }),
          },
        ),
    },
    {
      provide: PUBLICATION_SCHEDULING_SERVICE,
      inject: [TRANSACTION_RUNNER, EVENTING_REPOSITORY, AUDIT_SERVICE, OUTBOX_SERVICE],
      useFactory: (
        transactionRunner: TransactionRunner<EntityManager>,
        repository: EventingRepositoryPort<EntityManager>,
        auditService: AuditService<EntityManager>,
        outboxService: OutboxService<EntityManager>,
      ) =>
        new PublicationSchedulingService(
          transactionRunner,
          repository,
          auditService,
          outboxService,
        ),
    },
  ],
  exports: [EventingPersistenceModule, PUBLICATION_SCHEDULING_SERVICE],
})
export class EventingModule {}
