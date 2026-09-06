import type { EntityManager } from 'typeorm';

import type {
  EventConsumptionOwner,
  FinishWebhookExecutionInput,
  OutboxAttemptOwner,
  WebhookAttemptOwner,
} from '../../ports/eventing-attempt-owner';
import { unwrapTypeOrmMutationRows } from './typeorm-mutation-result';

export function requireEventingTransaction(transaction: EntityManager): void {
  if (!transaction.queryRunner?.isTransactionActive) {
    throw new Error('Eventing attempt changes require an active transaction.');
  }
}

function assertIdentity(owner: unknown, keys: readonly string[]): void {
  if (!owner || typeof owner !== 'object') throw new Error('A complete Eventing attempt owner is required.');
  const record = owner as Record<string, unknown>;
  if (
    keys.some((key) => typeof record[key] !== 'string' || (record[key] as string).length === 0) ||
    !Number.isSafeInteger(record.attemptNumber) || Number(record.attemptNumber) < 1
  ) {
    throw new Error('A complete Eventing attempt owner is required.');
  }
}

function changed(result: unknown, maximum = 1): boolean {
  const rows = unwrapTypeOrmMutationRows<{ id: string }>(result);
  if (rows.length > maximum || rows.some((row) => typeof row.id !== 'string')) {
    throw new Error('Unexpected Eventing mutation rows.');
  }
  return rows.length === 1;
}

export async function finishOutboxAttempt(
  owner: Readonly<OutboxAttemptOwner>,
  input: Readonly<{ status: 'dispatched' | 'pending' | 'dead'; at: Date; availableAt?: Date; error?: string }>,
  transaction: EntityManager,
): Promise<boolean> {
  requireEventingTransaction(transaction);
  assertIdentity(owner, ['eventId', 'workspaceId']);
  return changed(await transaction.query(
    `UPDATE outbox_events
     SET status = $4, claimed_at = NULL,
         dispatched_at = CASE WHEN $4 = 'dispatched' THEN $5::timestamptz ELSE NULL END,
         available_at = COALESCE($6::timestamptz, available_at), last_error = $7, updated_at = $5
     WHERE id = $1 AND workspace_id = $2 AND attempt_count = $3 AND status = 'processing'
     RETURNING id`,
    [owner.eventId, owner.workspaceId, owner.attemptNumber, input.status, input.at, input.availableAt ?? null, input.error ?? null],
  ));
}

export async function lockConsumption(
  owner: Readonly<EventConsumptionOwner>,
  transaction: EntityManager,
): Promise<boolean> {
  requireEventingTransaction(transaction);
  assertIdentity(owner, ['consumptionId', 'eventId', 'consumerKey', 'workspaceId']);
  return changed(await transaction.query(
    `SELECT consumption.id FROM event_consumptions consumption
     INNER JOIN outbox_events event ON event.id = consumption.event_id
     WHERE consumption.id = $1 AND consumption.event_id = $2 AND consumption.consumer_key = $3
       AND consumption.attempt_count = $4 AND consumption.status = 'processing'
       AND event.workspace_id = $5
     FOR UPDATE OF consumption`,
    [owner.consumptionId, owner.eventId, owner.consumerKey, owner.attemptNumber, owner.workspaceId],
  ));
}

export async function finishConsumption(
  owner: Readonly<EventConsumptionOwner>,
  status: 'succeeded' | 'failed',
  input: Readonly<{ processedAt: Date; result?: Readonly<Record<string, unknown>>; errorMessage?: string }>,
  transaction: EntityManager,
): Promise<boolean> {
  requireEventingTransaction(transaction);
  assertIdentity(owner, ['consumptionId', 'eventId', 'consumerKey', 'workspaceId']);
  return changed(await transaction.query(
    `UPDATE event_consumptions consumption
     SET status = $6, processed_at = $7, result_json = $8, last_error = $9, updated_at = $7
     FROM outbox_events event
     WHERE consumption.id = $1 AND consumption.event_id = $2 AND consumption.consumer_key = $3
       AND consumption.attempt_count = $4 AND consumption.status = 'processing'
       AND event.id = consumption.event_id AND event.workspace_id = $5
     RETURNING consumption.id`,
    [owner.consumptionId, owner.eventId, owner.consumerKey, owner.attemptNumber, owner.workspaceId,
      status, input.processedAt, input.result ? { ...input.result } : null, input.errorMessage ?? null],
  ));
}

/** Delivery -> Attempt -> Endpoint lock order is shared with recovery. HTTP is never in this transaction. */
export async function finishWebhookExecution(
  owner: Readonly<WebhookAttemptOwner>,
  input: Readonly<FinishWebhookExecutionInput>,
  transaction: EntityManager,
): Promise<boolean> {
  requireEventingTransaction(transaction);
  assertIdentity(owner, ['deliveryId', 'workspaceId', 'endpointId', 'attemptId']);
  if (!Number.isSafeInteger(owner.endpointVersion) || owner.endpointVersion < 1 ||
      !Number.isSafeInteger(input.endpointFailureThreshold) || input.endpointFailureThreshold < 1 ||
      !['succeeded', 'dead', 'retry_scheduled'].includes(input.status) ||
      !(input.finishedAt instanceof Date) || !Number.isFinite(input.finishedAt.getTime()) ||
      (input.status === 'retry_scheduled' && (!(input.nextRetryAt instanceof Date) ||
        !Number.isFinite(input.nextRetryAt.getTime()) || input.nextRetryAt < input.finishedAt)) ||
      (input.status !== 'retry_scheduled' && input.nextRetryAt !== undefined)) {
    throw new Error('A valid Webhook completion and captured endpoint version are required.');
  }
  const locked = changed(await transaction.query(
    `SELECT id FROM webhook_deliveries
     WHERE id = $1 AND workspace_id = $2 AND endpoint_id = $3 AND attempt_count = $4
       AND status = 'processing' FOR UPDATE`,
    [owner.deliveryId, owner.workspaceId, owner.endpointId, owner.attemptNumber],
  ));
  if (!locked) return false;
  const attemptLocked = changed(await transaction.query(
    `SELECT id FROM webhook_delivery_attempts
     WHERE id = $1 AND delivery_id = $2 AND attempt_number = $3 AND status = 'processing' FOR UPDATE`,
    [owner.attemptId, owner.deliveryId, owner.attemptNumber],
  ));
  if (!attemptLocked) return false;
  const deliveryChanged = changed(await transaction.query(
    `UPDATE webhook_deliveries
     SET status = $5, next_retry_at = $6, last_response_status = $7, last_response_excerpt = $8,
         last_error = $9, completed_at = $10, updated_at = $11
     WHERE id = $1 AND workspace_id = $2 AND endpoint_id = $3 AND attempt_count = $4
       AND status = 'processing' RETURNING id`,
    [owner.deliveryId, owner.workspaceId, owner.endpointId, owner.attemptNumber, input.status,
      input.nextRetryAt ?? null, input.responseStatus ?? null, input.responseBodyExcerpt ?? null,
      input.errorMessage ?? null, input.status === 'retry_scheduled' ? null : input.finishedAt, input.finishedAt],
  ));
  const attemptChanged = changed(await transaction.query(
    `UPDATE webhook_delivery_attempts
     SET status = $4, response_status = $5, response_body_excerpt = $6, error_message = $7, completed_at = $8
     WHERE id = $1 AND delivery_id = $2 AND attempt_number = $3 AND status = 'processing' RETURNING id`,
    [owner.attemptId, owner.deliveryId, owner.attemptNumber, input.status === 'succeeded' ? 'succeeded' : 'failed',
      input.responseStatus ?? null, input.responseBodyExcerpt ?? null, input.errorMessage ?? null, input.finishedAt],
  ));
  if (!deliveryChanged || !attemptChanged) throw new Error('Locked Webhook ownership changed unexpectedly.');
  // A configuration change/re-enable while HTTP was in flight starts a new counter policy.
  // Historical requests can finish their own delivery but must not disable/reset that new policy.
  if (input.status === 'succeeded') {
    changed(await transaction.query(
      `UPDATE webhook_endpoints SET consecutive_failure_count = 0, updated_at = $4
       WHERE id = $1 AND workspace_id = $2 AND version = $3 AND status = 'active' RETURNING id`,
      [owner.endpointId, owner.workspaceId, owner.endpointVersion, input.finishedAt],
    ));
  } else if (input.status === 'dead') {
    changed(await transaction.query(
      `UPDATE webhook_endpoints
       SET consecutive_failure_count = consecutive_failure_count + 1,
           status = CASE WHEN consecutive_failure_count + 1 >= $4 THEN 'disabled' ELSE status END,
           disabled_at = CASE WHEN consecutive_failure_count + 1 >= $4 THEN $5 ELSE disabled_at END,
           version = CASE WHEN consecutive_failure_count + 1 >= $4 THEN version + 1 ELSE version END,
           updated_at = $5
       WHERE id = $1 AND workspace_id = $2 AND version = $3 AND status = 'active' RETURNING id`,
      [owner.endpointId, owner.workspaceId, owner.endpointVersion, input.endpointFailureThreshold, input.finishedAt],
    ));
  }
  return true;
}

export async function recoverWebhookExecutions(
  staleBefore: Date,
  recoveredAt: Date,
  transaction: EntityManager,
): Promise<number> {
  requireEventingTransaction(transaction);
  const rows = unwrapTypeOrmMutationRows<{ id: string; attempt_count: number }>(await transaction.query(
    `WITH stale AS (
       SELECT id FROM webhook_deliveries WHERE status = 'processing' AND updated_at < $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE webhook_deliveries delivery SET status = 'retry_scheduled', next_retry_at = $2,
       last_error = 'Recovered stale processing attempt.', completed_at = NULL, updated_at = $2
     FROM stale WHERE delivery.id = stale.id RETURNING delivery.id, delivery.attempt_count`,
    [staleBefore, recoveredAt],
  ));
  for (const row of rows) {
    const closed = changed(await transaction.query(
      `UPDATE webhook_delivery_attempts
       SET status = 'failed', error_message = 'Recovered stale processing attempt.', completed_at = $3
       WHERE delivery_id = $1 AND attempt_number = $2 AND status = 'processing' RETURNING id`,
      [row.id, row.attempt_count, recoveredAt],
    ));
    if (!closed) throw new Error('Recovered Webhook delivery has no active matching attempt.');
  }
  return rows.length;
}
