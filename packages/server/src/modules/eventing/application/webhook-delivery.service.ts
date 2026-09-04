import type { AuditService, Clock, TransactionRunner } from '../../../core';
import {
  ActorType,
  AuditResult,
  ErrorCode,
  createUuidV7,
  requestContext,
  systemClock,
} from '../../../core';
import {
  WEBHOOK_RETRY_DELAYS_MS,
  WebhookDeliveryStatus,
  WebhookEndpointStatus,
  createWebhookSignature,
  retryAt,
  truncateOperationalMessage,
  type WebhookDeliveryExecution,
} from '../domain/eventing';
import type { EventingRepositoryPort } from '../ports/eventing.repository';
import type { WebhookSecretCipherPort } from '../ports/webhook-secret-cipher.port';
import type { WebhookSenderPort } from '../ports/webhook-sender.port';

export class WebhookDeliveryService<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: EventingRepositoryPort<TTransaction>,
    private readonly sender: WebhookSenderPort,
    private readonly secretCipher: WebhookSecretCipherPort,
    private readonly auditService: AuditService<TTransaction>,
    private readonly options: Readonly<{
      timeoutMilliseconds: number;
      endpointFailureThreshold: number;
    }>,
    private readonly clock: Clock = systemClock,
  ) {}

  public async deliver(deliveryId: string, attemptNumber: number): Promise<void> {
    const requestedAt = this.clock.now();
    const execution = await this.transactionRunner.run((transaction) =>
      this.repository.startWebhookDeliveryAttempt(
        deliveryId,
        {
          id: createUuidV7(requestedAt.getTime()),
          attemptNumber,
          requestedAt,
        },
        transaction,
      ),
    );

    if (!execution) {
      return;
    }

    const parent = requestContext.get();
    const requestId = createUuidV7(requestedAt.getTime());

    await requestContext.run(
      {
        requestId,
        traceId: parent?.traceId ?? requestId,
        correlationId: execution.event.id,
        actorType: ActorType.SYSTEM,
        actorId: 'worker:webhook-delivery',
        workspaceId: execution.delivery.workspaceId,
        siteId: execution.endpoint.siteId,
      },
      () => this.send(execution),
    );
  }

  private async send(execution: Readonly<WebhookDeliveryExecution>): Promise<void> {
    if (execution.endpoint.status !== WebhookEndpointStatus.ACTIVE) {
      await this.fail(execution, new Error('Webhook endpoint is disabled.'), undefined, true);
      return;
    }

    try {
      const secret = this.secretCipher.decrypt(
        execution.endpoint.secretCiphertext,
        execution.endpoint.secretKeyVersion,
      );
      const timestamp = Math.floor(this.clock.now().getTime() / 1_000).toString();
      const signature = createWebhookSignature(
        secret,
        timestamp,
        execution.event.id,
        execution.attempt.requestBody,
      );
      const response = await this.sender.send({
        url: execution.endpoint.url,
        body: execution.attempt.requestBody,
        timeoutMilliseconds: this.options.timeoutMilliseconds,
        headers: {
          'x-atlas-delivery-id': execution.delivery.id,
          'x-atlas-event': execution.event.eventType,
          'x-atlas-event-id': execution.event.id,
          'x-atlas-signature': signature,
          'x-atlas-timestamp': timestamp,
        },
      });

      if (response.status < 200 || response.status >= 300) {
        await this.fail(
          execution,
          new Error(`Webhook endpoint responded with HTTP ${response.status}.`),
          response,
          false,
        );
        return;
      }

      const completedAt = this.clock.now();
      await this.transactionRunner.run(async (transaction) => {
        await this.repository.completeWebhookDeliveryAttempt(
          {
            attemptId: execution.attempt.id,
            deliveryId: execution.delivery.id,
            status: 'succeeded',
            responseStatus: response.status,
            responseBodyExcerpt: response.bodyExcerpt,
            completedAt,
          },
          transaction,
        );
        await this.repository.completeWebhookDelivery(
          execution.delivery.id,
          {
            status: WebhookDeliveryStatus.SUCCEEDED,
            responseStatus: response.status,
            responseBodyExcerpt: response.bodyExcerpt,
            completedAt,
            updatedAt: completedAt,
          },
          transaction,
        );
        await this.repository.resetWebhookEndpointFailures(
          execution.endpoint.id,
          completedAt,
          transaction,
        );
        await this.auditService.record(
          {
            action: 'webhook.delivery-succeeded',
            targetType: 'webhook-delivery',
            targetId: execution.delivery.id,
            result: AuditResult.SUCCESS,
            metadata: {
              endpointId: execution.endpoint.id,
              eventId: execution.event.id,
              eventType: execution.event.eventType,
              attemptNumber: execution.attempt.attemptNumber,
              responseStatus: response.status,
            },
          },
          transaction,
        );
      });
    } catch (error) {
      await this.fail(execution, error, undefined, false);
    }
  }

  private async fail(
    execution: Readonly<WebhookDeliveryExecution>,
    error: unknown,
    response: Readonly<{ status: number; bodyExcerpt?: string }> | undefined,
    forceTerminal: boolean,
  ): Promise<void> {
    const completedAt = this.clock.now();
    const nextRetryAt = forceTerminal
      ? undefined
      : retryAt(completedAt, execution.attempt.attemptNumber, WEBHOOK_RETRY_DELAYS_MS);
    const terminal = nextRetryAt === undefined;
    const errorMessage = truncateOperationalMessage(error);

    await this.transactionRunner.run(async (transaction) => {
      await this.repository.completeWebhookDeliveryAttempt(
        {
          attemptId: execution.attempt.id,
          deliveryId: execution.delivery.id,
          status: 'failed',
          responseStatus: response?.status,
          responseBodyExcerpt: response?.bodyExcerpt,
          errorMessage,
          completedAt,
        },
        transaction,
      );
      await this.repository.completeWebhookDelivery(
        execution.delivery.id,
        {
          status: terminal ? WebhookDeliveryStatus.DEAD : WebhookDeliveryStatus.RETRY_SCHEDULED,
          responseStatus: response?.status,
          responseBodyExcerpt: response?.bodyExcerpt,
          errorMessage,
          nextRetryAt,
          completedAt: terminal ? completedAt : undefined,
          updatedAt: completedAt,
        },
        transaction,
      );

      if (!nextRetryAt) {
        await this.repository.incrementWebhookEndpointFailures(
          execution.endpoint.id,
          this.options.endpointFailureThreshold,
          completedAt,
          transaction,
        );
      }

      await this.auditService.record(
        {
          action: terminal ? 'webhook.delivery-dead' : 'webhook.delivery-retry-scheduled',
          targetType: 'webhook-delivery',
          targetId: execution.delivery.id,
          result: AuditResult.FAILURE,
          errorCode: ErrorCode.INTERNAL_ERROR,
          metadata: {
            endpointId: execution.endpoint.id,
            eventId: execution.event.id,
            eventType: execution.event.eventType,
            attemptNumber: execution.attempt.attemptNumber,
            responseStatus: response?.status,
            nextRetryAt: nextRetryAt?.toISOString(),
          },
        },
        transaction,
      );
    });
  }
}
