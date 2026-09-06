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
  WebhookEndpointStatus,
  createWebhookSignature,
  retryAt,
  type WebhookDeliveryExecution,
} from '../domain/eventing';
import {
  safeWebhookErrorMessage,
  safeWebhookResponseExcerpt,
  WebhookTransportError,
} from '../domain/webhook-diagnostics';
import type {
  EventingRepositoryPort,
  FinishWebhookExecutionInput,
  WebhookAttemptOwner,
} from '../ports/eventing.repository';
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
    if (!execution) return;
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
      await this.fail(execution, new WebhookTransportError('endpoint-disabled'), undefined, true);
      return;
    }
    let response: Awaited<ReturnType<WebhookSenderPort['send']>>;
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
      response = await this.sender.send({
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
    } catch (error) {
      await this.fail(execution, error, undefined, false);
      return;
    }
    // Persistence/Audit failure is not an HTTP failure. Propagate it instead of starting
    // a second completion that might overwrite the result of an ambiguous DB commit.
    if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      await this.fail(execution, new WebhookTransportError('invalid-response'), undefined, false);
      return;
    }
    if (response.status < 200 || response.status >= 300) {
      await this.fail(execution, new WebhookTransportError('http-non-success'), response, false);
      return;
    }
    await this.finish(execution, {
      status: 'succeeded',
      responseStatus: response.status,
      responseBodyExcerpt: response.bodyExcerpt,
      finishedAt: this.clock.now(),
      endpointFailureThreshold: this.options.endpointFailureThreshold,
    });
  }

  private async fail(
    execution: Readonly<WebhookDeliveryExecution>,
    error: unknown,
    response: Readonly<{ status: number; bodyExcerpt?: string }> | undefined,
    forceTerminal: boolean,
  ): Promise<void> {
    const finishedAt = this.clock.now();
    const nextRetryAt = forceTerminal
      ? undefined
      : retryAt(finishedAt, execution.attempt.attemptNumber, WEBHOOK_RETRY_DELAYS_MS);
    await this.finish(execution, {
      status: nextRetryAt ? 'retry_scheduled' : 'dead',
      responseStatus: response?.status,
      responseBodyExcerpt: response?.bodyExcerpt,
      errorMessage: safeWebhookErrorMessage(error),
      nextRetryAt,
      finishedAt,
      endpointFailureThreshold: this.options.endpointFailureThreshold,
    });
  }

  private async finish(
    execution: Readonly<WebhookDeliveryExecution>,
    input: Readonly<FinishWebhookExecutionInput>,
  ): Promise<void> {
    // Enforce the policy even for a different Sender adapter or an injected failure.
    const diagnostics = {
      ...input,
      responseBodyExcerpt: safeWebhookResponseExcerpt(input.responseBodyExcerpt),
      errorMessage: safeWebhookErrorMessage(input.errorMessage),
    };
    const owner: Readonly<WebhookAttemptOwner> = Object.freeze({
      deliveryId: execution.delivery.id,
      workspaceId: execution.delivery.workspaceId,
      endpointId: execution.endpoint.id,
      endpointVersion: execution.endpoint.version,
      attemptId: execution.attempt.id,
      attemptNumber: execution.attempt.attemptNumber,
    });
    await this.transactionRunner.run(async (transaction) => {
      const applied = await this.repository.finishWebhookDeliveryExecution(
        owner,
        diagnostics,
        transaction,
      );
      if (!applied) return;
      await this.auditService.record(
        {
          action:
            input.status === 'succeeded'
              ? 'webhook.delivery-succeeded'
              : input.status === 'dead'
                ? 'webhook.delivery-dead'
                : 'webhook.delivery-retry-scheduled',
          targetType: 'webhook-delivery',
          targetId: execution.delivery.id,
          result: input.status === 'succeeded' ? AuditResult.SUCCESS : AuditResult.FAILURE,
          errorCode: input.status === 'succeeded' ? undefined : ErrorCode.INTERNAL_ERROR,
          metadata: {
            endpointId: execution.endpoint.id,
            eventId: execution.event.id,
            eventType: execution.event.eventType,
            attemptNumber: execution.attempt.attemptNumber,
            responseStatus: input.responseStatus,
            nextRetryAt: input.nextRetryAt?.toISOString(),
          },
        },
        transaction,
      );
    });
  }
}
