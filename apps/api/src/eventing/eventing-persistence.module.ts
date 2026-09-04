import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import type { ApiEnvironment } from '@atlas/config';
import {
  Aes256GcmWebhookSecretCipher,
  EventConsumptionEntity,
  NodeWebhookSecretGenerator,
  OutboxEventEntity,
  OutboxService,
  PublicationScheduleEntity,
  TypeOrmEventingRepository,
  WebhookDeliveryAttemptEntity,
  WebhookDeliveryEntity,
  WebhookEndpointEntity,
} from '@atlas/server';

import {
  EVENTING_REPOSITORY,
  OUTBOX_SERVICE,
  WEBHOOK_SECRET_CIPHER,
  WEBHOOK_SECRET_GENERATOR,
} from './eventing.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OutboxEventEntity,
      EventConsumptionEntity,
      WebhookEndpointEntity,
      WebhookDeliveryEntity,
      WebhookDeliveryAttemptEntity,
      PublicationScheduleEntity,
    ]),
  ],
  providers: [
    {
      provide: EVENTING_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new TypeOrmEventingRepository(dataSource),
    },
    {
      provide: OUTBOX_SERVICE,
      inject: [EVENTING_REPOSITORY],
      useFactory: (repository: TypeOrmEventingRepository) => new OutboxService(repository),
    },
    {
      provide: WEBHOOK_SECRET_CIPHER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnvironment, true>) =>
        new Aes256GcmWebhookSecretCipher(
          config.get('WEBHOOK_SECRET_ENCRYPTION_KEY_BASE64', { infer: true }),
          config.get('WEBHOOK_SECRET_ENCRYPTION_KEY_VERSION', { infer: true }),
        ),
    },
    {
      provide: WEBHOOK_SECRET_GENERATOR,
      useFactory: () => new NodeWebhookSecretGenerator(),
    },
  ],
  exports: [EVENTING_REPOSITORY, OUTBOX_SERVICE, WEBHOOK_SECRET_CIPHER, WEBHOOK_SECRET_GENERATOR],
})
export class EventingPersistenceModule {}
