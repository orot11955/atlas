import type { DataSource, EntityManager } from 'typeorm';

import { createUuidV7 } from '../../../../core';
import {
  EventConsumptionStatus,
  OutboxEventStatus,
  WebhookEndpointStatus,
  type EventConsumptionRecord,
  type OutboxEventEnvelope,
  type OutboxEventRecord,
} from '../../domain/eventing';
import { TypeOrmEventingRepository } from './typeorm-eventing.repository';

interface OutboxEventRow {
  id: string;
  workspace_id: string;
  site_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  schema_version: number | string;
  payload_json: OutboxEventEnvelope;
  status: OutboxEventStatus;
  available_at: Date | string;
  claimed_at: Date | string | null;
  dispatched_at: Date | string | null;
  attempt_count: number | string;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface EventConsumptionRow {
  id: string;
  consumer_key: string;
  event_id: string;
  status: EventConsumptionStatus;
  attempt_count: number | string;
  claimed_at: Date | string;
  processed_at: Date | string | null;
  result_json: Record<string, unknown> | null;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface WebhookEndpointFailureRow {
  consecutive_failure_count: number | string;
  status: WebhookEndpointStatus;
}

/**
 * TypeORM's PostgreSQL query API returns SELECT rows directly, but mutation
 * queries with RETURNING may be represented as [rows, affectedCount]. Keep
 * that driver-specific shape at the persistence boundary rather than leaking
 * it into domain row mappers.
 */
export class SafeTypeOrmEventingRepository extends TypeOrmEventingRepository {
  public constructor(dataSource: DataSource) {
    super(dataSource);
  }

  public override async claimAvailableOutboxEvents(
    now: Date,
    staleBefore: Date,
    limit: number,
    transaction: EntityManager,
  ): Promise<readonly OutboxEventRecord[]> {
    const result = await transaction.query(
      `
        WITH candidates AS (
          SELECT "id"
          FROM "outbox_events"
          WHERE (
            ("status" = 'pending' AND "available_at" <= $1)
            OR ("status" = 'processing' AND "claimed_at" < $2)
          )
          ORDER BY "available_at" ASC, "created_at" ASC, "id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $3
        )
        UPDATE "outbox_events" AS event
        SET
          "status" = 'processing',
          "claimed_at" = $1,
          "dispatched_at" = NULL,
          "attempt_count" = event."attempt_count" + 1,
          "last_error" = NULL,
          "updated_at" = $1
        FROM candidates
        WHERE event."id" = candidates."id"
        RETURNING event.*
      `,
      [now, staleBefore, limit],
    );

    return unwrapTypeOrmMutationRows<OutboxEventRow>(result).map(toOutboxEventRecord);
  }

  public override async rescheduleOutboxEvent(
    eventId: string,
    availableAt: Date,
    errorMessage: string,
    terminal: boolean,
    updatedAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    const result = await transaction.query(
      `
        UPDATE "outbox_events"
        SET
          "status" = $2,
          "available_at" = $3,
          "claimed_at" = NULL,
          "dispatched_at" = NULL,
          "last_error" = $4,
          "updated_at" = $5
        WHERE "id" = $1 AND "status" = 'processing'
        RETURNING "id"
      `,
      [eventId, terminal ? 'dead' : 'pending', availableAt, errorMessage, updatedAt],
    );

    if (unwrapTypeOrmMutationRows<{ id: string }>(result).length !== 1) {
      throw new Error('Outbox Event was not in processing state while rescheduling.');
    }
  }

  public override async retryDeadOutboxEvent(
    workspaceId: string,
    eventId: string,
    availableAt: Date,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.query(
      `
        UPDATE "outbox_events"
        SET
          "status" = 'pending',
          "available_at" = $3,
          "claimed_at" = NULL,
          "dispatched_at" = NULL,
          "last_error" = NULL,
          "updated_at" = $3
        WHERE "workspace_id" = $1 AND "id" = $2 AND "status" = 'dead'
        RETURNING "id"
      `,
      [workspaceId, eventId, availableAt],
    );

    return unwrapTypeOrmMutationRows<{ id: string }>(result).length === 1;
  }

  public override async claimEventConsumption(
    eventId: string,
    consumerKey: string,
    claimedAt: Date,
    staleBefore: Date,
    transaction: EntityManager,
  ): Promise<EventConsumptionRecord | undefined> {
    const id = createUuidV7(claimedAt.getTime());
    const result = await transaction.query(
      `
        INSERT INTO "event_consumptions" (
          "id", "consumer_key", "event_id", "status", "attempt_count",
          "claimed_at", "processed_at", "result_json", "last_error", "created_at", "updated_at"
        )
        VALUES ($1, $2, $3, 'processing', 1, $4, NULL, NULL, NULL, $4, $4)
        ON CONFLICT ("consumer_key", "event_id") DO UPDATE
        SET
          "status" = 'processing',
          "attempt_count" = "event_consumptions"."attempt_count" + 1,
          "claimed_at" = EXCLUDED."claimed_at",
          "processed_at" = NULL,
          "result_json" = NULL,
          "last_error" = NULL,
          "updated_at" = EXCLUDED."updated_at"
        WHERE "event_consumptions"."status" = 'failed'
           OR ("event_consumptions"."status" = 'processing' AND "event_consumptions"."claimed_at" < $5)
        RETURNING *
      `,
      [id, consumerKey, eventId, claimedAt, staleBefore],
    );
    const row = unwrapTypeOrmMutationRows<EventConsumptionRow>(result)[0];

    return row ? toEventConsumptionRecord(row) : undefined;
  }

  public override async incrementWebhookEndpointFailures(
    endpointId: string,
    threshold: number,
    updatedAt: Date,
    transaction: EntityManager,
  ): Promise<{ failureCount: number; disabled: boolean }> {
    const result = await transaction.query(
      `
        UPDATE "webhook_endpoints"
        SET
          "consecutive_failure_count" = "consecutive_failure_count" + 1,
          "status" = CASE
            WHEN "consecutive_failure_count" + 1 >= $2 THEN 'disabled'
            ELSE "status"
          END,
          "disabled_at" = CASE
            WHEN "consecutive_failure_count" + 1 >= $2 THEN $3
            ELSE "disabled_at"
          END,
          "version" = CASE
            WHEN "consecutive_failure_count" + 1 >= $2 AND "status" <> 'disabled'
              THEN "version" + 1
            ELSE "version"
          END,
          "updated_at" = $3
        WHERE "id" = $1
        RETURNING "consecutive_failure_count", "status"
      `,
      [endpointId, threshold, updatedAt],
    );
    const row = unwrapTypeOrmMutationRows<WebhookEndpointFailureRow>(result)[0];

    return {
      failureCount: Number(row?.consecutive_failure_count ?? 0),
      disabled: row?.status === WebhookEndpointStatus.DISABLED,
    };
  }
}

export function unwrapTypeOrmMutationRows<T>(result: unknown): readonly T[] {
  if (Array.isArray(result)) {
    if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
      return result[0] as readonly T[];
    }

    return result as readonly T[];
  }

  if (isRecord(result)) {
    for (const key of ['records', 'rows', 'raw'] as const) {
      const candidate = result[key];
      if (Array.isArray(candidate)) {
        return candidate as readonly T[];
      }
    }
  }

  throw new Error('TypeORM mutation query returned an unsupported result shape.');
}

function toOutboxEventRecord(row: OutboxEventRow): OutboxEventRecord {
  if (!row.payload_json || typeof row.payload_json !== 'object' || !row.payload_json.data) {
    throw new Error('Outbox Event query returned an invalid payload_json value.');
  }

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    siteId: row.site_id ?? undefined,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    schemaVersion: Number(row.schema_version),
    payload: Object.freeze({
      ...row.payload_json,
      data: Object.freeze({ ...row.payload_json.data }),
    }),
    status: row.status,
    availableAt: new Date(row.available_at),
    claimedAt: row.claimed_at ? new Date(row.claimed_at) : undefined,
    dispatchedAt: row.dispatched_at ? new Date(row.dispatched_at) : undefined,
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toEventConsumptionRecord(row: EventConsumptionRow): EventConsumptionRecord {
  return {
    id: row.id,
    consumerKey: row.consumer_key,
    eventId: row.event_id,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    claimedAt: new Date(row.claimed_at),
    processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
    result: row.result_json ? Object.freeze({ ...row.result_json }) : undefined,
    lastError: row.last_error ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
