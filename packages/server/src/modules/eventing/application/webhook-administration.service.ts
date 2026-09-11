import type { AuditService, Clock, TransactionRunner } from '../../../core';
import {
  ActorType,
  AuditResult,
  DomainError,
  ErrorCode,
  createUuidV7,
  requestContext,
  systemClock,
} from '../../../core';
import {
  EventType,
  WebhookDeliveryStatus,
  WebhookEndpointStatus,
  normalizeWebhookEventTypes,
  normalizeWebhookName,
  normalizeWebhookUrl,
  toWebhookEndpointView,
  type WebhookDeliveryView,
  type WebhookEndpointView,
} from '../domain/eventing';
import type { EventingRepositoryPort } from '../ports/eventing.repository';
import type { WebhookSecretCipherPort } from '../ports/webhook-secret-cipher.port';
import type { WebhookSecretGeneratorPort } from '../ports/webhook-secret-generator.port';
import type { OutboxService } from './outbox.service';

export interface CreateWebhookEndpointInput {
  siteId: string;
  name: string;
  url: string;
  subscribedEvents: readonly string[];
}

export interface UpdateWebhookEndpointInput {
  version: number;
  name: string;
  url: string;
  subscribedEvents: readonly string[];
}

export interface WebhookEndpointSecretResult {
  endpoint: Readonly<WebhookEndpointView>;
  secret: string;
}

export interface WebhookDeliveryListQuery {
  endpointId?: string;
  status?: WebhookDeliveryStatus;
  limit?: number;
}

export class WebhookAdministrationService<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: EventingRepositoryPort<TTransaction>,
    private readonly auditService: AuditService<TTransaction>,
    private readonly outboxService: OutboxService<TTransaction>,
    private readonly secretGenerator: WebhookSecretGeneratorPort,
    private readonly secretCipher: WebhookSecretCipherPort,
    private readonly urlPolicy: Readonly<{ allowHttp: boolean; allowPrivateNetwork: boolean }>,
    private readonly clock: Clock = systemClock,
  ) {}

  public async listEndpoints(
    workspaceId: string,
    siteId?: string,
  ): Promise<readonly Readonly<WebhookEndpointView>[]> {
    const records = await this.repository.listWebhookEndpoints(workspaceId, siteId);
    return Object.freeze(records.map(toWebhookEndpointView));
  }

  public async createEndpoint(
    workspaceId: string,
    input: Readonly<CreateWebhookEndpointInput>,
  ): Promise<Readonly<WebhookEndpointSecretResult>> {
    const actorId = requireAdminActorId();
    const createdAt = this.clock.now();
    const id = createUuidV7(createdAt.getTime());
    const name = normalizeWebhookName(input.name);
    const url = normalizeWebhookUrl(input.url, this.urlPolicy);
    const subscribedEvents = normalizeWebhookEventTypes(input.subscribedEvents);
    const secret = this.secretGenerator.generate();
    const encrypted = this.secretCipher.encrypt(secret);

    try {
      return await this.transactionRunner.run(async (transaction) => {
        const site = await this.repository.findSite(workspaceId, input.siteId, transaction);

        if (!site) {
          throw new DomainError({ code: ErrorCode.SITE_NOT_FOUND, message: 'Site was not found.' });
        }
        if (site.status === 'archived') {
          throw new DomainError({
            code: ErrorCode.INVALID_STATE_TRANSITION,
            message: 'Archived Sites cannot receive Webhook endpoints.',
          });
        }

        const record = {
          id,
          workspaceId,
          siteId: site.id,
          siteKey: site.key,
          siteName: site.name,
          name,
          url,
          status: WebhookEndpointStatus.ACTIVE,
          secretCiphertext: encrypted.encryptedValue,
          secretKeyVersion: encrypted.keyVersion,
          subscribedEvents,
          consecutiveFailureCount: 0,
          version: 1,
          createdByAdminAccountId: actorId,
          createdAt,
          updatedAt: createdAt,
        } as const;

        await this.repository.insertWebhookEndpoint(record, transaction);
        await this.auditService.record(
          {
            action: 'webhook.endpoint-created',
            targetType: 'webhook-endpoint',
            targetId: id,
            result: AuditResult.SUCCESS,
            metadata: {
              siteId: site.id,
              name,
              url,
              subscribedEvents,
            },
          },
          transaction,
        );

        return Object.freeze({ endpoint: toWebhookEndpointView(record), secret });
      });
    } catch (error) {
      throw mapWebhookConstraintError(error);
    }
  }

  public async updateEndpoint(
    workspaceId: string,
    endpointId: string,
    input: Readonly<UpdateWebhookEndpointInput>,
  ): Promise<Readonly<WebhookEndpointView>> {
    assertPositiveVersion(input.version);
    const name = normalizeWebhookName(input.name);
    const url = normalizeWebhookUrl(input.url, this.urlPolicy);
    const subscribedEvents = normalizeWebhookEventTypes(input.subscribedEvents);
    const updatedAt = this.clock.now();

    try {
      return await this.transactionRunner.run(async (transaction) => {
        const current = await this.repository.findWebhookEndpointForUpdate(
          workspaceId,
          endpointId,
          transaction,
        );

        if (!current) {
          throw webhookEndpointNotFoundError();
        }

        const updated = await this.repository.updateWebhookEndpoint(
          workspaceId,
          endpointId,
          {
            expectedVersion: input.version,
            nextVersion: input.version + 1,
            name,
            url,
            subscribedEvents,
            updatedAt,
          },
          transaction,
        );

        if (!updated) {
          throw versionConflictError('Webhook endpoint was changed by another request.');
        }

        await this.auditService.record(
          {
            action: 'webhook.endpoint-updated',
            targetType: 'webhook-endpoint',
            targetId: endpointId,
            result: AuditResult.SUCCESS,
            metadata: { siteId: current.siteId, name, url, subscribedEvents },
          },
          transaction,
        );

        return toWebhookEndpointView({
          ...current,
          name,
          url,
          subscribedEvents,
          version: input.version + 1,
          updatedAt,
        });
      });
    } catch (error) {
      throw mapWebhookConstraintError(error);
    }
  }

  public async rotateSecret(
    workspaceId: string,
    endpointId: string,
    version: number,
  ): Promise<Readonly<WebhookEndpointSecretResult>> {
    assertPositiveVersion(version);
    const rotatedAt = this.clock.now();
    const secret = this.secretGenerator.generate();
    const encrypted = this.secretCipher.encrypt(secret);

    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findWebhookEndpointForUpdate(
        workspaceId,
        endpointId,
        transaction,
      );

      if (!current) {
        throw webhookEndpointNotFoundError();
      }

      const rotated = await this.repository.rotateWebhookSecret(
        workspaceId,
        endpointId,
        {
          expectedVersion: version,
          nextVersion: version + 1,
          secretCiphertext: encrypted.encryptedValue,
          secretKeyVersion: encrypted.keyVersion,
          updatedAt: rotatedAt,
        },
        transaction,
      );

      if (!rotated) {
        throw versionConflictError('Webhook endpoint was changed by another request.');
      }

      await this.auditService.record(
        {
          action: 'webhook.secret-rotated',
          targetType: 'webhook-endpoint',
          targetId: endpointId,
          result: AuditResult.SUCCESS,
          metadata: { siteId: current.siteId, version: version + 1 },
        },
        transaction,
      );

      return Object.freeze({
        endpoint: toWebhookEndpointView({
          ...current,
          secretCiphertext: encrypted.encryptedValue,
          secretKeyVersion: encrypted.keyVersion,
          version: version + 1,
          updatedAt: rotatedAt,
        }),
        secret,
      });
    });
  }

  public async enableEndpoint(
    workspaceId: string,
    endpointId: string,
    version: number,
  ): Promise<Readonly<WebhookEndpointView>> {
    return this.setEndpointStatus(workspaceId, endpointId, version, WebhookEndpointStatus.ACTIVE);
  }

  public async disableEndpoint(
    workspaceId: string,
    endpointId: string,
    version: number,
  ): Promise<Readonly<WebhookEndpointView>> {
    return this.setEndpointStatus(workspaceId, endpointId, version, WebhookEndpointStatus.DISABLED);
  }

  public async listDeliveries(
    workspaceId: string,
    query: Readonly<WebhookDeliveryListQuery> = {},
  ): Promise<readonly Readonly<WebhookDeliveryView>[]> {
    const limit = normalizeLimit(query.limit);
    const records = await this.repository.listWebhookDeliveries(workspaceId, {
      endpointId: query.endpointId,
      status: query.status,
      limit,
    });

    return Object.freeze(records.map(freezeDeliveryView));
  }

  public async retryDelivery(
    workspaceId: string,
    deliveryId: string,
  ): Promise<Readonly<{ deliveryId: string; attemptNumber: number }>> {
    const requestedAt = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const delivery = await this.repository.findWebhookDeliveryForUpdate(
        workspaceId,
        deliveryId,
        transaction,
      );

      if (!delivery) {
        throw new DomainError({
          code: ErrorCode.NOT_FOUND,
          message: 'Webhook delivery was not found.',
        });
      }

      const reset = await this.repository.resetWebhookDeliveryForRetry(
        workspaceId,
        deliveryId,
        requestedAt,
        transaction,
      );

      if (!reset) {
        throw new DomainError({
          code: ErrorCode.INVALID_STATE_TRANSITION,
          message: 'Only dead or retry-scheduled Webhook deliveries can be retried manually.',
        });
      }

      const attemptNumber = delivery.attemptCount + 1;
      await this.outboxService.record(
        {
          workspaceId,
          aggregateType: 'webhook-delivery',
          aggregateId: deliveryId,
          eventType: EventType.WEBHOOK_DELIVERY_RETRY_REQUESTED,
          data: {
            deliveryId,
            attemptNumber,
            availableAt: requestedAt.toISOString(),
          },
        },
        transaction,
      );
      await this.auditService.record(
        {
          action: 'webhook.delivery-retry-requested',
          targetType: 'webhook-delivery',
          targetId: deliveryId,
          result: AuditResult.SUCCESS,
          metadata: { eventId: delivery.eventId, endpointId: delivery.endpointId, attemptNumber },
        },
        transaction,
      );

      return Object.freeze({ deliveryId, attemptNumber });
    });
  }

  private async setEndpointStatus(
    workspaceId: string,
    endpointId: string,
    version: number,
    status: WebhookEndpointStatus,
  ): Promise<Readonly<WebhookEndpointView>> {
    assertPositiveVersion(version);
    const updatedAt = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findWebhookEndpointForUpdate(
        workspaceId,
        endpointId,
        transaction,
      );

      if (!current) {
        throw webhookEndpointNotFoundError();
      }

      if (current.status === status) {
        return toWebhookEndpointView(current);
      }

      const disabledAt = status === WebhookEndpointStatus.DISABLED ? updatedAt : undefined;
      const updated = await this.repository.setWebhookEndpointStatus(
        workspaceId,
        endpointId,
        {
          expectedVersion: version,
          nextVersion: version + 1,
          status,
          disabledAt,
          updatedAt,
        },
        transaction,
      );

      if (!updated) {
        throw versionConflictError('Webhook endpoint was changed by another request.');
      }

      await this.auditService.record(
        {
          action:
            status === WebhookEndpointStatus.ACTIVE
              ? 'webhook.endpoint-enabled'
              : 'webhook.endpoint-disabled',
          targetType: 'webhook-endpoint',
          targetId: endpointId,
          result: AuditResult.SUCCESS,
          metadata: { siteId: current.siteId, version: version + 1 },
        },
        transaction,
      );

      return toWebhookEndpointView({
        ...current,
        status,
        consecutiveFailureCount:
          status === WebhookEndpointStatus.ACTIVE ? 0 : current.consecutiveFailureCount,
        disabledAt,
        version: version + 1,
        updatedAt,
      });
    });
  }
}

function requireAdminActorId(): string {
  const context = requestContext.require();

  if (context.actorType !== ActorType.ADMIN || !context.actorId) {
    throw new DomainError({
      code: ErrorCode.AUTH_REQUIRED,
      message: 'An authenticated administrator is required.',
    });
  }

  return context.actorId;
}

function assertPositiveVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Webhook endpoint version must be a positive safe integer.',
      details: { field: 'version' },
    });
  }
}

function normalizeLimit(value?: number): number {
  if (value === undefined) {
    return 100;
  }

  if (!Number.isSafeInteger(value) || value < 1 || value > 200) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Webhook delivery limit must be between 1 and 200.',
      details: { field: 'limit' },
    });
  }

  return value;
}

function webhookEndpointNotFoundError(): DomainError {
  return new DomainError({
    code: ErrorCode.NOT_FOUND,
    message: 'Webhook endpoint was not found.',
  });
}

function versionConflictError(message: string): DomainError {
  return new DomainError({ code: ErrorCode.VERSION_CONFLICT, message });
}

function mapWebhookConstraintError(error: unknown): unknown {
  if (isPostgresError(error, '23505')) {
    return new DomainError({
      code: ErrorCode.VERSION_CONFLICT,
      message: 'A Webhook endpoint with the same URL already exists for this Site.',
      details: { field: 'url' },
      cause: error,
    });
  }

  return error;
}

function isPostgresError(error: unknown, code: string): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && String(error.code) === code,
  );
}

function freezeDeliveryView(record: WebhookDeliveryView): Readonly<WebhookDeliveryView> {
  return Object.freeze({
    ...record,
    attempts: Object.freeze(
      record.attempts.map((attempt) =>
        Object.freeze({
          ...attempt,
          requestedAt: new Date(attempt.requestedAt),
          completedAt: attempt.completedAt ? new Date(attempt.completedAt) : undefined,
        }),
      ),
    ),
    nextRetryAt: record.nextRetryAt ? new Date(record.nextRetryAt) : undefined,
    completedAt: record.completedAt ? new Date(record.completedAt) : undefined,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  });
}
