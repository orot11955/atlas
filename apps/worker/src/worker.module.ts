import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import type { EntityManager } from '@atlas/database';

import { workerEnvironmentSchema, type WorkerEnvironment } from '@atlas/config';
import {
  MinioObjectStorageAdapter,
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '@atlas/object-storage';
import {
  ATLAS_LOGGER,
  Aes256GcmWebhookSecretCipher,
  AssetProcessingService,
  AuditService,
  ContentPublicationService,
  NodeWebhookSender,
  OutboxConsumerService,
  OutboxRelayService,
  OutboxService,
  PublicationScheduleProcessor,
  TypeOrmAssetProcessingRepository,
  TypeOrmAuditRepository,
  TypeOrmContentAssetRepository,
  TypeOrmContentPublicationRepository,
  TypeOrmEventingRepository,
  TypeOrmTransactionRunner,
  WebhookDeliveryService,
  createAtlasLogger,
  systemClock,
  type EventingQueuePort,
  type EventingRepositoryPort,
  type OutboxRecorderPort,
  type PublicationCommandPort,
  type WebhookSecretCipherPort,
  type WebhookSenderPort,
} from '@atlas/server';

import { BullMqEventingQueue } from './eventing/bullmq-eventing.queue';
import { EventingRelayLoop } from './eventing/eventing-relay.loop';
import {
  WORKER_EVENTING_QUEUE,
  WORKER_EVENTING_REPOSITORY,
  WORKER_OUTBOX_CONSUMER_SERVICE,
  WORKER_OUTBOX_RELAY_SERVICE,
  WORKER_OUTBOX_SERVICE,
  WORKER_PUBLICATION_COMMAND,
  WORKER_PUBLICATION_SCHEDULE_PROCESSOR,
  WORKER_WEBHOOK_DELIVERY_SERVICE,
  WORKER_WEBHOOK_SECRET_CIPHER,
  WORKER_WEBHOOK_SENDER,
} from './eventing/eventing.tokens';
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
          createAuditService(database),
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
    {
      provide: WORKER_EVENTING_REPOSITORY,
      inject: [WorkerDatabaseService],
      useFactory: (database: WorkerDatabaseService): EventingRepositoryPort<EntityManager> =>
        new TypeOrmEventingRepository(database.dataSource),
    },
    BullMqEventingQueue,
    {
      provide: WORKER_EVENTING_QUEUE,
      useExisting: BullMqEventingQueue,
    },
    {
      provide: WORKER_OUTBOX_SERVICE,
      inject: [WORKER_EVENTING_REPOSITORY],
      useFactory: (repository: EventingRepositoryPort<EntityManager>) =>
        new OutboxService(repository),
    },
    {
      provide: WORKER_WEBHOOK_SECRET_CIPHER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkerEnvironment, true>): WebhookSecretCipherPort =>
        new Aes256GcmWebhookSecretCipher(
          config.get('WEBHOOK_SECRET_ENCRYPTION_KEY_BASE64', { infer: true }),
          config.get('WEBHOOK_SECRET_ENCRYPTION_KEY_VERSION', { infer: true }),
        ),
    },
    {
      provide: WORKER_WEBHOOK_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkerEnvironment, true>): WebhookSenderPort =>
        new NodeWebhookSender({
          allowHttp:
            config.get('NODE_ENV', { infer: true }) !== 'production' &&
            config.get('WEBHOOK_ALLOW_HTTP', { infer: true }),
          allowPrivateNetwork:
            config.get('NODE_ENV', { infer: true }) !== 'production' &&
            config.get('WEBHOOK_ALLOW_PRIVATE_NETWORK', { infer: true }),
          maximumResponseBytes: config.get('WEBHOOK_RESPONSE_MAX_BYTES', { infer: true }),
        }),
    },
    {
      provide: WORKER_OUTBOX_CONSUMER_SERVICE,
      inject: [
        WorkerDatabaseService,
        WORKER_EVENTING_REPOSITORY,
        WORKER_EVENTING_QUEUE,
        ConfigService,
      ],
      useFactory: (
        database: WorkerDatabaseService,
        repository: EventingRepositoryPort<EntityManager>,
        queue: EventingQueuePort,
        config: ConfigService<WorkerEnvironment, true>,
      ) =>
        new OutboxConsumerService(
          new TypeOrmTransactionRunner(database.dataSource),
          repository,
          queue,
          createAuditService(database),
          {
            staleMilliseconds: config.get('OUTBOX_CLAIM_TIMEOUT_SECONDS', { infer: true }) * 1_000,
          },
        ),
    },
    {
      provide: WORKER_WEBHOOK_DELIVERY_SERVICE,
      inject: [
        WorkerDatabaseService,
        WORKER_EVENTING_REPOSITORY,
        WORKER_WEBHOOK_SENDER,
        WORKER_WEBHOOK_SECRET_CIPHER,
        ConfigService,
      ],
      useFactory: (
        database: WorkerDatabaseService,
        repository: EventingRepositoryPort<EntityManager>,
        sender: WebhookSenderPort,
        secretCipher: WebhookSecretCipherPort,
        config: ConfigService<WorkerEnvironment, true>,
      ) =>
        new WebhookDeliveryService(
          new TypeOrmTransactionRunner(database.dataSource),
          repository,
          sender,
          secretCipher,
          createAuditService(database),
          {
            timeoutMilliseconds: config.get('WEBHOOK_DELIVERY_TIMEOUT_MS', { infer: true }),
            endpointFailureThreshold: config.get('WEBHOOK_ENDPOINT_FAILURE_THRESHOLD', {
              infer: true,
            }),
          },
        ),
    },
    {
      provide: WORKER_PUBLICATION_COMMAND,
      inject: [WorkerDatabaseService, OBJECT_STORAGE, WORKER_OUTBOX_SERVICE],
      useFactory: (
        database: WorkerDatabaseService,
        objectStorage: ObjectStoragePort,
        outboxService: OutboxRecorderPort<EntityManager>,
      ): PublicationCommandPort =>
        new ContentPublicationService(
          new TypeOrmTransactionRunner(database.dataSource),
          new TypeOrmContentPublicationRepository(database.dataSource),
          createAuditService(database),
          new TypeOrmContentAssetRepository(database.dataSource),
          objectStorage,
          systemClock,
          outboxService,
        ),
    },
    {
      provide: WORKER_PUBLICATION_SCHEDULE_PROCESSOR,
      inject: [WorkerDatabaseService, WORKER_EVENTING_REPOSITORY, WORKER_PUBLICATION_COMMAND],
      useFactory: (
        database: WorkerDatabaseService,
        repository: EventingRepositoryPort<EntityManager>,
        command: PublicationCommandPort,
      ) =>
        new PublicationScheduleProcessor(
          new TypeOrmTransactionRunner(database.dataSource),
          repository,
          command,
          createAuditService(database),
        ),
    },
    {
      provide: WORKER_OUTBOX_RELAY_SERVICE,
      inject: [
        WorkerDatabaseService,
        WORKER_EVENTING_REPOSITORY,
        WORKER_EVENTING_QUEUE,
        ConfigService,
      ],
      useFactory: (
        database: WorkerDatabaseService,
        repository: EventingRepositoryPort<EntityManager>,
        queue: EventingQueuePort,
        config: ConfigService<WorkerEnvironment, true>,
      ) =>
        new OutboxRelayService(
          new TypeOrmTransactionRunner(database.dataSource),
          repository,
          queue,
          {
            outboxBatchSize: config.get('OUTBOX_RELAY_BATCH_SIZE', { infer: true }),
            outboxStaleMilliseconds:
              config.get('OUTBOX_CLAIM_TIMEOUT_SECONDS', { infer: true }) * 1_000,
            webhookBatchSize: config.get('WEBHOOK_DELIVERY_BATCH_SIZE', { infer: true }),
            webhookStaleMilliseconds:
              config.get('WEBHOOK_DELIVERY_CLAIM_TIMEOUT_SECONDS', { infer: true }) * 1_000,
            publicationBatchSize: config.get('PUBLICATION_SCHEDULE_BATCH_SIZE', {
              infer: true,
            }),
            publicationStaleMilliseconds:
              config.get('PUBLICATION_SCHEDULE_CLAIM_TIMEOUT_SECONDS', { infer: true }) * 1_000,
            maximumAttempts: config.get('OUTBOX_RELAY_MAX_ATTEMPTS', { infer: true }),
          },
        ),
    },
    EventingRelayLoop,
    SystemQueueWorker,
    MediaQueueWorker,
  ],
})
export class WorkerModule {}

function createAuditService(database: WorkerDatabaseService): AuditService<EntityManager> {
  return new AuditService(new TypeOrmAuditRepository(database.dataSource));
}
