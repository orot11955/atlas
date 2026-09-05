import type { DataSource, EntityManager } from 'typeorm';

import { createUuidV7 } from '../../../../core';
import { SiteEntity } from '../../../site/infrastructure/persistence/site.entity';
import {
  EventConsumptionStatus,
  OutboxEventStatus,
  PublicationScheduleStatus,
  WebhookDeliveryAttemptStatus,
  WebhookDeliveryStatus,
  WebhookEndpointStatus,
  type ContentSiteScheduleTarget,
  type EventConsumptionRecord,
  type OutboxEventEnvelope,
  type OutboxEventRecord,
  type PublicationScheduleRecord,
  type WebhookDeliveryAttemptRecord,
  type WebhookDeliveryExecution,
  type WebhookDeliveryRecord,
  type WebhookDeliveryView,
  type WebhookEndpointRecord,
  type WebhookEventType,
} from '../../domain/eventing';
import type {
  CompleteWebhookAttemptInput,
  CompleteWebhookDeliveryInput,
  CreatePublicationScheduleRecordInput,
  CreateWebhookEndpointRecordInput,
  EventingRepositoryPort,
  InsertOutboxEventInput,
  InsertWebhookDeliveryInput,
  RotateWebhookSecretRecordInput,
  SetWebhookEndpointStatusRecordInput,
  UpdateWebhookEndpointRecordInput,
} from '../../ports/eventing.repository';
import {
  OutboxEventEntity,
  PublicationScheduleEntity,
  WebhookDeliveryAttemptEntity,
  WebhookDeliveryEntity,
  WebhookEndpointEntity,
} from './eventing.entities';

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

interface WebhookEndpointRow {
  id: string;
  workspace_id: string;
  site_id: string;
  site_key?: string;
  site_name?: string;
  name: string;
  url: string;
  status: WebhookEndpointStatus;
  secret_ciphertext: string;
  secret_key_version: string;
  subscribed_events: WebhookEventType[];
  consecutive_failure_count: number | string;
  disabled_at: Date | string | null;
  version: number | string;
  created_by_admin_account_id: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface WebhookDeliveryRow {
  id: string;
  workspace_id: string;
  endpoint_id: string;
  event_id: string;
  event_type: string;
  endpoint_name?: string;
  endpoint_url?: string;
  site_id?: string;
  status: WebhookDeliveryStatus;
  attempt_count: number | string;
  next_retry_at: Date | string | null;
  last_response_status: number | string | null;
  last_response_excerpt: string | null;
  last_error: string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface WebhookAttemptRow {
  id: string;
  delivery_id: string;
  attempt_number: number | string;
  status: 'processing' | 'succeeded' | 'failed';
  request_body: string;
  response_status: number | string | null;
  response_body_excerpt: string | null;
  error_message: string | null;
  requested_at: Date | string;
  completed_at: Date | string | null;
}

interface PublicationScheduleRow {
  id: string;
  workspace_id: string;
  site_id: string;
  site_key?: string;
  site_name?: string;
  content_id: string;
  content_title?: string;
  content_site_id: string;
  revision_id: string | null;
  revision_number: number | string | null;
  action: 'publish' | 'withdraw';
  scheduled_for: Date | string;
  timezone: string;
  scheduled_local_at: string;
  status: PublicationScheduleStatus;
  attempt_count: number | string;
  next_attempt_at: Date | string;
  last_error: string | null;
  completed_at: Date | string | null;
  cancelled_at: Date | string | null;
  version: number | string;
  requested_by_admin_account_id: string;
  created_at: Date | string;
  updated_at: Date | string;
}

export class TypeOrmEventingRepository implements EventingRepositoryPort<EntityManager> {
  public constructor(private readonly dataSource: DataSource) {}

  public async insertOutboxEvent(
    input: InsertOutboxEventInput,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(OutboxEventEntity).insert({
      id: input.id,
      workspaceId: input.workspaceId,
      siteId: input.siteId ?? null,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      schemaVersion: input.schemaVersion,
      payloadJson: { ...input.payload, data: { ...input.payload.data } } as never,
      status: input.status,
      availableAt: input.availableAt,
      claimedAt: input.claimedAt ?? null,
      dispatchedAt: input.dispatchedAt ?? null,
      attemptCount: input.attemptCount,
      lastError: input.lastError ?? null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });
  }

  public async listOutboxEvents(
    workspaceId: string,
    query: Readonly<{ status?: OutboxEventStatus; limit: number }>,
  ): Promise<readonly OutboxEventRecord[]> {
    const parameters: unknown[] = [workspaceId, query.limit];
    const statusFilter = query.status ? 'AND "status" = $3' : '';
    if (query.status) parameters.push(query.status);
    const rows = await this.dataSource.query<OutboxEventRow[]>(
      `
        SELECT *
        FROM "outbox_events"
        WHERE "workspace_id" = $1
        ${statusFilter}
        ORDER BY "created_at" DESC, "id" DESC
        LIMIT $2
      `,
      parameters,
    );
    return rows.map(toOutboxEventRecord);
  }

  public async findOutboxEvent(
    eventId: string,
    transaction?: EntityManager,
  ): Promise<OutboxEventRecord | undefined> {
    const rows = await (transaction ?? this.dataSource.manager).query<OutboxEventRow[]>(
      'SELECT * FROM "outbox_events" WHERE "id" = $1 LIMIT 1',
      [eventId],
    );
    return rows[0] ? toOutboxEventRecord(rows[0]) : undefined;
  }

  public async claimAvailableOutboxEvents(
    now: Date,
    staleBefore: Date,
    limit: number,
    transaction: EntityManager,
  ): Promise<readonly OutboxEventRecord[]> {
    const rows = await transaction.query<OutboxEventRow[]>(
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
    return rows.map(toOutboxEventRecord);
  }

  public async markOutboxEventDispatched(
    eventId: string,
    dispatchedAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.query(
      `
        UPDATE "outbox_events"
        SET
          "status" = 'dispatched',
          "claimed_at" = NULL,
          "dispatched_at" = $2,
          "last_error" = NULL,
          "updated_at" = $2
        WHERE "id" = $1 AND "status" = 'processing'
      `,
      [eventId, dispatchedAt],
    );
  }

  public async rescheduleOutboxEvent(
    eventId: string,
    availableAt: Date,
    errorMessage: string,
    terminal: boolean,
    updatedAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    const result = await transaction.query<{ id: string }[]>(
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

    if (result.length !== 1) {
      throw new Error('Outbox Event was not in processing state while rescheduling.');
    }
  }

  public async retryDeadOutboxEvent(
    workspaceId: string,
    eventId: string,
    availableAt: Date,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.query<{ id: string }[]>(
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
    return result.length === 1;
  }

  public async claimEventConsumption(
    eventId: string,
    consumerKey: string,
    claimedAt: Date,
    staleBefore: Date,
    transaction: EntityManager,
  ): Promise<EventConsumptionRecord | undefined> {
    const id = createUuidV7(claimedAt.getTime());
    const rows = await transaction.query<EventConsumptionRow[]>(
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
    return rows[0] ? toEventConsumptionRecord(rows[0]) : undefined;
  }

  public async completeEventConsumption(
    consumptionId: string,
    status: 'succeeded' | 'failed',
    input: Readonly<{
      processedAt: Date;
      result?: Readonly<Record<string, unknown>>;
      errorMessage?: string;
    }>,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.query(
      `
        UPDATE "event_consumptions"
        SET
          "status" = $2,
          "processed_at" = $3,
          "result_json" = $4,
          "last_error" = $5,
          "updated_at" = $3
        WHERE "id" = $1 AND "status" = 'processing'
      `,
      [
        consumptionId,
        status,
        input.processedAt,
        input.result ? { ...input.result } : null,
        input.errorMessage ?? null,
      ],
    );
  }

  public async findSite(
    workspaceId: string,
    siteId: string,
    transaction?: EntityManager,
  ): Promise<{ id: string; key: string; name: string; status: string } | undefined> {
    const entity = await (transaction ?? this.dataSource.manager)
      .getRepository(SiteEntity)
      .findOne({
        where: { id: siteId, workspaceId },
        select: { id: true, key: true, name: true, status: true },
      });

    return entity
      ? { id: entity.id, key: entity.key, name: entity.name, status: entity.status }
      : undefined;
  }

  public async listWebhookEndpoints(
    workspaceId: string,
    siteId?: string,
  ): Promise<readonly WebhookEndpointRecord[]> {
    const parameters: unknown[] = [workspaceId];
    const siteFilter = siteId ? 'AND endpoint."site_id" = $2' : '';

    if (siteId) {
      parameters.push(siteId);
    }

    const rows = await this.dataSource.query<WebhookEndpointRow[]>(
      `
        SELECT
          endpoint.*,
          site."key" AS site_key,
          site."name" AS site_name
        FROM "webhook_endpoints" endpoint
        INNER JOIN "sites" site
          ON site."id" = endpoint."site_id"
          AND site."workspace_id" = endpoint."workspace_id"
        WHERE endpoint."workspace_id" = $1
        ${siteFilter}
        ORDER BY endpoint."created_at" DESC, endpoint."id" DESC
        LIMIT 200
      `,
      parameters,
    );

    return rows.map(toWebhookEndpointRecord);
  }

  public async findWebhookEndpointForUpdate(
    workspaceId: string,
    endpointId: string,
    transaction: EntityManager,
  ): Promise<WebhookEndpointRecord | undefined> {
    const entity = await transaction
      .getRepository(WebhookEndpointEntity)
      .createQueryBuilder('endpoint')
      .setLock('pessimistic_write')
      .where('endpoint.id = :endpointId', { endpointId })
      .andWhere('endpoint.workspace_id = :workspaceId', { workspaceId })
      .getOne();

    return entity ? toWebhookEndpointRecordFromEntity(entity) : undefined;
  }

  public async insertWebhookEndpoint(
    input: CreateWebhookEndpointRecordInput,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(WebhookEndpointEntity).insert({
      id: input.id,
      workspaceId: input.workspaceId,
      siteId: input.siteId,
      name: input.name,
      url: input.url,
      status: input.status,
      secretCiphertext: input.secretCiphertext,
      secretKeyVersion: input.secretKeyVersion,
      subscribedEvents: [...input.subscribedEvents],
      consecutiveFailureCount: input.consecutiveFailureCount,
      disabledAt: null,
      version: input.version,
      createdByAdminAccountId: input.createdByAdminAccountId,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });
  }

  public async updateWebhookEndpoint(
    workspaceId: string,
    endpointId: string,
    input: UpdateWebhookEndpointRecordInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(WebhookEndpointEntity).update(
      { id: endpointId, workspaceId, version: input.expectedVersion },
      {
        name: input.name,
        url: input.url,
        subscribedEvents: [...input.subscribedEvents],
        version: input.nextVersion,
        updatedAt: input.updatedAt,
      },
    );

    return (result.affected ?? 0) === 1;
  }

  public async rotateWebhookSecret(
    workspaceId: string,
    endpointId: string,
    input: RotateWebhookSecretRecordInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(WebhookEndpointEntity).update(
      { id: endpointId, workspaceId, version: input.expectedVersion },
      {
        secretCiphertext: input.secretCiphertext,
        secretKeyVersion: input.secretKeyVersion,
        version: input.nextVersion,
        updatedAt: input.updatedAt,
      },
    );

    return (result.affected ?? 0) === 1;
  }

  public async setWebhookEndpointStatus(
    workspaceId: string,
    endpointId: string,
    input: SetWebhookEndpointStatusRecordInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(WebhookEndpointEntity).update(
      { id: endpointId, workspaceId, version: input.expectedVersion },
      {
        status: input.status,
        disabledAt: input.disabledAt ?? null,
        ...(input.status === WebhookEndpointStatus.ACTIVE ? { consecutiveFailureCount: 0 } : {}),
        version: input.nextVersion,
        updatedAt: input.updatedAt,
      },
    );

    return (result.affected ?? 0) === 1;
  }

  public async listActiveWebhookEndpointsForEvent(
    workspaceId: string,
    siteId: string,
    eventType: WebhookEventType,
  ): Promise<readonly WebhookEndpointRecord[]> {
    const rows = await this.dataSource.query<WebhookEndpointRow[]>(
      `
        SELECT endpoint.*
        FROM "webhook_endpoints" endpoint
        WHERE endpoint."workspace_id" = $1
          AND endpoint."site_id" = $2
          AND endpoint."status" = 'active'
          AND $3 = ANY(endpoint."subscribed_events")
        ORDER BY endpoint."created_at" ASC, endpoint."id" ASC
      `,
      [workspaceId, siteId, eventType],
    );

    return rows.map(toWebhookEndpointRecord);
  }

  public async insertWebhookDeliveryIfAbsent(
    input: InsertWebhookDeliveryInput,
    transaction: EntityManager,
  ): Promise<WebhookDeliveryRecord> {
    await transaction.query(
      `
        INSERT INTO "webhook_deliveries" (
          "id",
          "workspace_id",
          "endpoint_id",
          "event_id",
          "status",
          "attempt_count",
          "created_at",
          "updated_at"
        ) VALUES ($1, $2, $3, $4, 'pending', 0, $5, $5)
        ON CONFLICT ("endpoint_id", "event_id") DO NOTHING
      `,
      [input.id, input.workspaceId, input.endpointId, input.eventId, input.createdAt],
    );

    const rows = await transaction.query<WebhookDeliveryRow[]>(
      `
        SELECT delivery.*, event."event_type"
        FROM "webhook_deliveries" delivery
        INNER JOIN "outbox_events" event ON event."id" = delivery."event_id"
        WHERE delivery."endpoint_id" = $1 AND delivery."event_id" = $2
      `,
      [input.endpointId, input.eventId],
    );
    const row = rows[0];

    if (!row) {
      throw new Error('Webhook delivery could not be created.');
    }

    return toWebhookDeliveryRecord(row);
  }

  public async listWebhookDeliveries(
    workspaceId: string,
    query: Readonly<{
      endpointId?: string;
      status?: WebhookDeliveryStatus;
      limit: number;
    }>,
  ): Promise<readonly WebhookDeliveryView[]> {
    const parameters: unknown[] = [workspaceId, query.limit];
    const filters: string[] = [];

    if (query.endpointId) {
      parameters.push(query.endpointId);
      filters.push(`delivery."endpoint_id" = $${parameters.length}`);
    }
    if (query.status) {
      parameters.push(query.status);
      filters.push(`delivery."status" = $${parameters.length}`);
    }

    const whereExtra = filters.length ? `AND ${filters.join(' AND ')}` : '';
    const rows = await this.dataSource.query<WebhookDeliveryRow[]>(
      `
        SELECT
          delivery.*,
          event."event_type",
          endpoint."name" AS endpoint_name,
          endpoint."url" AS endpoint_url,
          endpoint."site_id"
        FROM "webhook_deliveries" delivery
        INNER JOIN "outbox_events" event ON event."id" = delivery."event_id"
        INNER JOIN "webhook_endpoints" endpoint ON endpoint."id" = delivery."endpoint_id"
        WHERE delivery."workspace_id" = $1
        ${whereExtra}
        ORDER BY delivery."created_at" DESC, delivery."id" DESC
        LIMIT $2
      `,
      parameters,
    );

    if (rows.length === 0) {
      return [];
    }

    const attempts = await this.dataSource.query<WebhookAttemptRow[]>(
      `
        SELECT attempt.*
        FROM "webhook_delivery_attempts" attempt
        WHERE attempt."delivery_id" = ANY($1::uuid[])
        ORDER BY attempt."delivery_id", attempt."attempt_number" DESC
      `,
      [rows.map((row) => row.id)],
    );
    const attemptsByDelivery = new Map<string, WebhookDeliveryAttemptRecord[]>();

    for (const attempt of attempts) {
      const current = attemptsByDelivery.get(attempt.delivery_id) ?? [];
      current.push(toWebhookAttemptRecord(attempt));
      attemptsByDelivery.set(attempt.delivery_id, current);
    }

    return rows.map((row) => ({
      ...toWebhookDeliveryRecord(row),
      endpointName: row.endpoint_name ?? '',
      endpointUrl: row.endpoint_url ?? '',
      siteId: row.site_id ?? '',
      attempts: Object.freeze(attemptsByDelivery.get(row.id) ?? []),
    }));
  }

  public async recoverStaleWebhookDeliveries(
    staleBefore: Date,
    recoveredAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.query(
      `
        WITH stale AS (
          SELECT delivery."id"
          FROM "webhook_deliveries" delivery
          WHERE delivery."status" = 'processing'
            AND delivery."updated_at" < $1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "webhook_delivery_attempts" attempt
        SET
          "status" = 'failed',
          "error_message" = 'Recovered stale processing attempt.',
          "completed_at" = $2
        FROM stale
        WHERE attempt."delivery_id" = stale."id"
          AND attempt."status" = 'processing'
      `,
      [staleBefore, recoveredAt],
    );
    await transaction.query(
      `
        UPDATE "webhook_deliveries"
        SET
          "status" = 'retry_scheduled',
          "next_retry_at" = $2,
          "last_error" = 'Recovered stale processing attempt.',
          "completed_at" = NULL,
          "updated_at" = $2
        WHERE "status" = 'processing'
          AND "updated_at" < $1
      `,
      [staleBefore, recoveredAt],
    );
  }

  public async listDueWebhookDeliveries(
    now: Date,
    limit: number,
  ): Promise<readonly WebhookDeliveryRecord[]> {
    const rows = await this.dataSource.query<WebhookDeliveryRow[]>(
      `
        SELECT delivery.*, event."event_type"
        FROM "webhook_deliveries" delivery
        INNER JOIN "outbox_events" event ON event."id" = delivery."event_id"
        WHERE delivery."status" = 'retry_scheduled'
          AND delivery."next_retry_at" <= $1
        ORDER BY delivery."next_retry_at" ASC, delivery."id" ASC
        LIMIT $2
      `,
      [now, limit],
    );

    return rows.map(toWebhookDeliveryRecord);
  }

  public async findWebhookDeliveryForUpdate(
    workspaceId: string,
    deliveryId: string,
    transaction: EntityManager,
  ): Promise<WebhookDeliveryRecord | undefined> {
    const rows = await transaction.query<WebhookDeliveryRow[]>(
      `
        SELECT delivery.*, event."event_type"
        FROM "webhook_deliveries" delivery
        INNER JOIN "outbox_events" event ON event."id" = delivery."event_id"
        WHERE delivery."id" = $1 AND delivery."workspace_id" = $2
        FOR UPDATE OF delivery
      `,
      [deliveryId, workspaceId],
    );

    return rows[0] ? toWebhookDeliveryRecord(rows[0]) : undefined;
  }

  public async resetWebhookDeliveryForRetry(
    workspaceId: string,
    deliveryId: string,
    updatedAt: Date,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction
      .getRepository(WebhookDeliveryEntity)
      .createQueryBuilder()
      .update(WebhookDeliveryEntity)
      .set({
        status: WebhookDeliveryStatus.PENDING,
        nextRetryAt: null,
        completedAt: null,
        lastError: null,
        updatedAt,
      })
      .where('id = :deliveryId', { deliveryId })
      .andWhere('workspace_id = :workspaceId', { workspaceId })
      .andWhere("status IN ('dead', 'retry_scheduled')")
      .execute();

    return (result.affected ?? 0) === 1;
  }

  public async startWebhookDeliveryAttempt(
    deliveryId: string,
    attempt: Readonly<{ id: string; attemptNumber: number; requestedAt: Date }>,
    transaction: EntityManager,
  ): Promise<WebhookDeliveryExecution | undefined> {
    const rows = await transaction.query<
      (WebhookDeliveryRow & WebhookEndpointRow & OutboxEventRow)[]
    >(
      `
        SELECT
          delivery."id" AS delivery_id_value,
          delivery."workspace_id" AS delivery_workspace_id,
          delivery."endpoint_id" AS delivery_endpoint_id,
          delivery."event_id" AS delivery_event_id,
          delivery."status" AS delivery_status,
          delivery."attempt_count" AS delivery_attempt_count,
          delivery."next_retry_at" AS delivery_next_retry_at,
          delivery."last_response_status" AS delivery_last_response_status,
          delivery."last_response_excerpt" AS delivery_last_response_excerpt,
          delivery."last_error" AS delivery_last_error,
          delivery."completed_at" AS delivery_completed_at,
          delivery."created_at" AS delivery_created_at,
          delivery."updated_at" AS delivery_updated_at,
          endpoint."id" AS endpoint_id_value,
          endpoint."workspace_id" AS endpoint_workspace_id,
          endpoint."site_id" AS endpoint_site_id,
          endpoint."name" AS endpoint_name_value,
          endpoint."url" AS endpoint_url_value,
          endpoint."status" AS endpoint_status_value,
          endpoint."secret_ciphertext" AS endpoint_secret_ciphertext,
          endpoint."secret_key_version" AS endpoint_secret_key_version,
          endpoint."subscribed_events" AS endpoint_subscribed_events,
          endpoint."consecutive_failure_count" AS endpoint_failure_count,
          endpoint."disabled_at" AS endpoint_disabled_at,
          endpoint."version" AS endpoint_version,
          endpoint."created_by_admin_account_id" AS endpoint_created_by,
          endpoint."created_at" AS endpoint_created_at,
          endpoint."updated_at" AS endpoint_updated_at,
          event.*
        FROM "webhook_deliveries" delivery
        INNER JOIN "webhook_endpoints" endpoint ON endpoint."id" = delivery."endpoint_id"
        INNER JOIN "outbox_events" event ON event."id" = delivery."event_id"
        WHERE delivery."id" = $1
        FOR UPDATE OF delivery
      `,
      [deliveryId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;

    if (!row) {
      return undefined;
    }

    const currentStatus = String(row.delivery_status) as WebhookDeliveryStatus;
    const currentAttemptCount = Number(row.delivery_attempt_count);

    if (
      (currentStatus !== WebhookDeliveryStatus.PENDING &&
        currentStatus !== WebhookDeliveryStatus.RETRY_SCHEDULED) ||
      attempt.attemptNumber !== currentAttemptCount + 1
    ) {
      return undefined;
    }

    const requestBody = JSON.stringify((row.payload_json as OutboxEventEnvelope) ?? {});

    await transaction.getRepository(WebhookDeliveryEntity).update(
      { id: deliveryId },
      {
        status: WebhookDeliveryStatus.PROCESSING,
        attemptCount: attempt.attemptNumber,
        nextRetryAt: null,
        completedAt: null,
        updatedAt: attempt.requestedAt,
      },
    );
    await transaction.getRepository(WebhookDeliveryAttemptEntity).insert({
      id: attempt.id,
      deliveryId,
      attemptNumber: attempt.attemptNumber,
      status: WebhookDeliveryAttemptStatus.PROCESSING,
      requestBody,
      responseStatus: null,
      responseBodyExcerpt: null,
      errorMessage: null,
      requestedAt: attempt.requestedAt,
      completedAt: null,
    });

    const event = toOutboxEventRecord({
      id: String(row.id),
      workspace_id: String(row.workspace_id),
      site_id: nullableString(row.site_id),
      aggregate_type: String(row.aggregate_type),
      aggregate_id: String(row.aggregate_id),
      event_type: String(row.event_type),
      schema_version: Number(row.schema_version),
      payload_json: row.payload_json as OutboxEventEnvelope,
      status: String(row.status) as OutboxEventStatus,
      available_at: row.available_at as Date,
      claimed_at: row.claimed_at as Date | null,
      dispatched_at: row.dispatched_at as Date | null,
      attempt_count: Number(row.attempt_count),
      last_error: nullableString(row.last_error),
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    });
    const endpoint: WebhookEndpointRecord = {
      id: String(row.endpoint_id_value),
      workspaceId: String(row.endpoint_workspace_id),
      siteId: String(row.endpoint_site_id),
      name: String(row.endpoint_name_value),
      url: String(row.endpoint_url_value),
      status: String(row.endpoint_status_value) as WebhookEndpointStatus,
      secretCiphertext: String(row.endpoint_secret_ciphertext),
      secretKeyVersion: String(row.endpoint_secret_key_version),
      subscribedEvents: Object.freeze([
        ...((row.endpoint_subscribed_events as WebhookEventType[]) ?? []),
      ]),
      consecutiveFailureCount: Number(row.endpoint_failure_count),
      disabledAt: row.endpoint_disabled_at ? new Date(row.endpoint_disabled_at as Date) : undefined,
      version: Number(row.endpoint_version),
      createdByAdminAccountId: String(row.endpoint_created_by),
      createdAt: new Date(row.endpoint_created_at as Date),
      updatedAt: new Date(row.endpoint_updated_at as Date),
    };
    const delivery: WebhookDeliveryRecord = {
      id: String(row.delivery_id_value),
      workspaceId: String(row.delivery_workspace_id),
      endpointId: String(row.delivery_endpoint_id),
      eventId: String(row.delivery_event_id),
      eventType: event.eventType,
      status: WebhookDeliveryStatus.PROCESSING,
      attemptCount: attempt.attemptNumber,
      lastResponseStatus: numberOrUndefined(row.delivery_last_response_status),
      lastResponseExcerpt: nullableString(row.delivery_last_response_excerpt) ?? undefined,
      lastError: nullableString(row.delivery_last_error) ?? undefined,
      createdAt: new Date(row.delivery_created_at as Date),
      updatedAt: new Date(attempt.requestedAt),
    };

    const attemptRecord: WebhookDeliveryAttemptRecord = {
      id: attempt.id,
      deliveryId,
      attemptNumber: attempt.attemptNumber,
      status: WebhookDeliveryAttemptStatus.PROCESSING,
      requestBody,
      requestedAt: new Date(attempt.requestedAt),
    };

    return { delivery, endpoint, event, attempt: attemptRecord };
  }

  public async completeWebhookDeliveryAttempt(
    input: CompleteWebhookAttemptInput,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(WebhookDeliveryAttemptEntity).update(
      { id: input.attemptId, deliveryId: input.deliveryId },
      {
        status:
          input.status === 'succeeded'
            ? WebhookDeliveryAttemptStatus.SUCCEEDED
            : WebhookDeliveryAttemptStatus.FAILED,
        responseStatus: input.responseStatus ?? null,
        responseBodyExcerpt: input.responseBodyExcerpt ?? null,
        errorMessage: input.errorMessage ?? null,
        completedAt: input.completedAt,
      },
    );
  }

  public async completeWebhookDelivery(
    deliveryId: string,
    input: CompleteWebhookDeliveryInput,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(WebhookDeliveryEntity).update(
      { id: deliveryId },
      {
        status: input.status,
        nextRetryAt: input.nextRetryAt ?? null,
        lastResponseStatus: input.responseStatus ?? null,
        lastResponseExcerpt: input.responseBodyExcerpt ?? null,
        lastError: input.errorMessage ?? null,
        completedAt: input.completedAt ?? null,
        updatedAt: input.updatedAt,
      },
    );
  }

  public async resetWebhookEndpointFailures(
    endpointId: string,
    updatedAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction
      .getRepository(WebhookEndpointEntity)
      .update({ id: endpointId }, { consecutiveFailureCount: 0, updatedAt });
  }

  public async incrementWebhookEndpointFailures(
    endpointId: string,
    threshold: number,
    updatedAt: Date,
    transaction: EntityManager,
  ): Promise<{ failureCount: number; disabled: boolean }> {
    const rows = await transaction.query<
      { consecutive_failure_count: number | string; status: WebhookEndpointStatus }[]
    >(
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
    const row = rows[0];

    return {
      failureCount: Number(row?.consecutive_failure_count ?? 0),
      disabled: row?.status === WebhookEndpointStatus.DISABLED,
    };
  }

  public async findContentSiteScheduleTarget(
    workspaceId: string,
    contentId: string,
    contentSiteId: string,
    transaction: EntityManager,
  ): Promise<ContentSiteScheduleTarget | undefined> {
    const rows = await transaction.query<
      {
        workspace_id: string;
        site_id: string;
        site_status: string;
        site_timezone: string;
        content_id: string;
        content_status: string;
        content_site_id: string;
        ready_revision_id: string | null;
        ready_revision_number: number | string | null;
        active_publication_id: string | null;
      }[]
    >(
      `
        SELECT
          content_site."workspace_id",
          content_site."site_id",
          site."status" AS site_status,
          site."timezone" AS site_timezone,
          content_site."content_id",
          content."status" AS content_status,
          content_site."id" AS content_site_id,
          ready_revision."id" AS ready_revision_id,
          content."ready_revision_number" AS ready_revision_number,
          publication."id" AS active_publication_id
        FROM "content_sites" content_site
        INNER JOIN "contents" content
          ON content."id" = content_site."content_id"
          AND content."workspace_id" = content_site."workspace_id"
        INNER JOIN "sites" site
          ON site."id" = content_site."site_id"
          AND site."workspace_id" = content_site."workspace_id"
        LEFT JOIN "content_revisions" ready_revision
          ON ready_revision."content_id" = content."id"
          AND ready_revision."workspace_id" = content."workspace_id"
          AND ready_revision."revision_number" = content."ready_revision_number"
          AND ready_revision."kind" = 'ready'
        LEFT JOIN "content_publications" publication
          ON publication."content_site_id" = content_site."id"
          AND publication."workspace_id" = content_site."workspace_id"
          AND publication."status" = 'active'
        WHERE content_site."workspace_id" = $1
          AND content_site."content_id" = $2
          AND content_site."id" = $3
        FOR UPDATE OF content_site
      `,
      [workspaceId, contentId, contentSiteId],
    );
    const row = rows[0];

    return row
      ? {
          workspaceId: row.workspace_id,
          siteId: row.site_id,
          siteStatus: row.site_status,
          siteTimezone: row.site_timezone,
          contentId: row.content_id,
          contentStatus: row.content_status,
          contentSiteId: row.content_site_id,
          readyRevisionId: row.ready_revision_id ?? undefined,
          readyRevisionNumber:
            row.ready_revision_number === null ? undefined : Number(row.ready_revision_number),
          activePublicationId: row.active_publication_id ?? undefined,
        }
      : undefined;
  }

  public async insertPublicationSchedule(
    input: CreatePublicationScheduleRecordInput,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(PublicationScheduleEntity).insert({
      id: input.id,
      workspaceId: input.workspaceId,
      siteId: input.siteId,
      contentId: input.contentId,
      contentSiteId: input.contentSiteId,
      revisionId: input.revisionId ?? null,
      revisionNumber: input.revisionNumber ?? null,
      action: input.action,
      scheduledFor: input.scheduledFor,
      timezone: input.timezone,
      scheduledLocalAt: input.scheduledLocalAt,
      status: PublicationScheduleStatus.PENDING,
      attemptCount: 0,
      nextAttemptAt: input.scheduledFor,
      lastError: null,
      completedAt: null,
      cancelledAt: null,
      version: 1,
      requestedByAdminAccountId: input.requestedByAdminAccountId,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
  }

  public async listPublicationSchedules(
    workspaceId: string,
    query: Readonly<{ contentId?: string; contentSiteId?: string; limit: number }>,
  ): Promise<readonly PublicationScheduleRecord[]> {
    const parameters: unknown[] = [workspaceId, query.limit];
    const filters: string[] = [];

    if (query.contentId) {
      parameters.push(query.contentId);
      filters.push(`schedule."content_id" = $${parameters.length}`);
    }
    if (query.contentSiteId) {
      parameters.push(query.contentSiteId);
      filters.push(`schedule."content_site_id" = $${parameters.length}`);
    }

    const whereExtra = filters.length ? `AND ${filters.join(' AND ')}` : '';
    const rows = await this.dataSource.query<PublicationScheduleRow[]>(
      `
        SELECT
          schedule.*,
          site."key" AS site_key,
          site."name" AS site_name,
          draft."title" AS content_title
        FROM "publication_schedules" schedule
        INNER JOIN "sites" site
          ON site."id" = schedule."site_id"
          AND site."workspace_id" = schedule."workspace_id"
        INNER JOIN "content_drafts" draft
          ON draft."content_id" = schedule."content_id"
          AND draft."workspace_id" = schedule."workspace_id"
        WHERE schedule."workspace_id" = $1
        ${whereExtra}
        ORDER BY schedule."created_at" DESC, schedule."id" DESC
        LIMIT $2
      `,
      parameters,
    );

    return rows.map(toPublicationScheduleRecord);
  }

  public async recoverStalePublicationSchedules(
    staleBefore: Date,
    recoveredAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.query(
      `
        UPDATE "publication_schedules"
        SET
          "status" = 'pending',
          "next_attempt_at" = $2,
          "last_error" = 'Recovered stale processing attempt.',
          "version" = "version" + 1,
          "updated_at" = $2
        WHERE "status" = 'processing' AND "updated_at" < $1
      `,
      [staleBefore, recoveredAt],
    );
  }

  public async listDuePublicationSchedules(
    now: Date,
    limit: number,
  ): Promise<readonly PublicationScheduleRecord[]> {
    const rows = await this.dataSource.query<PublicationScheduleRow[]>(
      `
        SELECT schedule.*
        FROM "publication_schedules" schedule
        WHERE schedule."status" = 'pending'
          AND schedule."next_attempt_at" <= $1
        ORDER BY schedule."next_attempt_at" ASC, schedule."id" ASC
        LIMIT $2
      `,
      [now, limit],
    );

    return rows.map(toPublicationScheduleRecord);
  }

  public async findPublicationScheduleForUpdate(
    workspaceId: string,
    scheduleId: string,
    transaction: EntityManager,
  ): Promise<PublicationScheduleRecord | undefined> {
    const entity = await transaction
      .getRepository(PublicationScheduleEntity)
      .createQueryBuilder('schedule')
      .setLock('pessimistic_write')
      .where('schedule.id = :scheduleId', { scheduleId })
      .andWhere('schedule.workspace_id = :workspaceId', { workspaceId })
      .getOne();

    return entity ? toPublicationScheduleRecordFromEntity(entity) : undefined;
  }

  public async cancelPublicationSchedule(
    workspaceId: string,
    scheduleId: string,
    expectedVersion: number,
    cancelledAt: Date,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction
      .getRepository(PublicationScheduleEntity)
      .createQueryBuilder()
      .update(PublicationScheduleEntity)
      .set({
        status: PublicationScheduleStatus.CANCELLED,
        cancelledAt,
        version: () => 'version + 1',
        updatedAt: cancelledAt,
      })
      .where('id = :scheduleId', { scheduleId })
      .andWhere('workspace_id = :workspaceId', { workspaceId })
      .andWhere('version = :expectedVersion', { expectedVersion })
      .andWhere("status = 'pending'")
      .execute();

    return (result.affected ?? 0) === 1;
  }

  public async retryPublicationSchedule(
    workspaceId: string,
    scheduleId: string,
    expectedVersion: number,
    retriedAt: Date,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction
      .getRepository(PublicationScheduleEntity)
      .createQueryBuilder()
      .update(PublicationScheduleEntity)
      .set({
        status: PublicationScheduleStatus.PENDING,
        nextAttemptAt: retriedAt,
        lastError: null,
        completedAt: null,
        version: () => 'version + 1',
        updatedAt: retriedAt,
      })
      .where('id = :scheduleId', { scheduleId })
      .andWhere('workspace_id = :workspaceId', { workspaceId })
      .andWhere('version = :expectedVersion', { expectedVersion })
      .andWhere("status = 'failed'")
      .execute();

    return (result.affected ?? 0) === 1;
  }

  public async startPublicationScheduleAttempt(
    scheduleId: string,
    attemptNumber: number,
    startedAt: Date,
    transaction: EntityManager,
  ): Promise<PublicationScheduleRecord | undefined> {
    const entity = await transaction
      .getRepository(PublicationScheduleEntity)
      .createQueryBuilder('schedule')
      .setLock('pessimistic_write')
      .where('schedule.id = :scheduleId', { scheduleId })
      .getOne();

    if (
      !entity ||
      entity.status !== PublicationScheduleStatus.PENDING ||
      entity.nextAttemptAt.getTime() > startedAt.getTime() ||
      attemptNumber !== entity.attemptCount + 1
    ) {
      return undefined;
    }

    entity.status = PublicationScheduleStatus.PROCESSING;
    entity.attemptCount = attemptNumber;
    entity.version += 1;
    entity.updatedAt = startedAt;
    await transaction.getRepository(PublicationScheduleEntity).save(entity);

    return toPublicationScheduleRecordFromEntity(entity);
  }

  public async completePublicationSchedule(
    scheduleId: string,
    completedAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(PublicationScheduleEntity).update(
      { id: scheduleId, status: PublicationScheduleStatus.PROCESSING },
      {
        status: PublicationScheduleStatus.COMPLETED,
        completedAt,
        lastError: null,
        version: () => 'version + 1',
        updatedAt: completedAt,
      },
    );
  }

  public async reschedulePublicationSchedule(
    scheduleId: string,
    nextAttemptAt: Date,
    errorMessage: string,
    terminal: boolean,
    updatedAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(PublicationScheduleEntity).update(
      { id: scheduleId },
      {
        status: terminal ? PublicationScheduleStatus.FAILED : PublicationScheduleStatus.PENDING,
        nextAttemptAt,
        lastError: errorMessage,
        completedAt: terminal ? updatedAt : null,
        version: () => 'version + 1',
        updatedAt,
      },
    );
  }
}

function toOutboxEventRecord(row: OutboxEventRow): OutboxEventRecord {
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

function toWebhookEndpointRecord(row: WebhookEndpointRow): WebhookEndpointRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    siteKey: row.site_key,
    siteName: row.site_name,
    name: row.name,
    url: row.url,
    status: row.status,
    secretCiphertext: row.secret_ciphertext,
    secretKeyVersion: row.secret_key_version,
    subscribedEvents: Object.freeze([...row.subscribed_events]),
    consecutiveFailureCount: Number(row.consecutive_failure_count),
    disabledAt: row.disabled_at ? new Date(row.disabled_at) : undefined,
    version: Number(row.version),
    createdByAdminAccountId: row.created_by_admin_account_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toWebhookEndpointRecordFromEntity(entity: WebhookEndpointEntity): WebhookEndpointRecord {
  return {
    id: entity.id,
    workspaceId: entity.workspaceId,
    siteId: entity.siteId,
    name: entity.name,
    url: entity.url,
    status: entity.status,
    secretCiphertext: entity.secretCiphertext,
    secretKeyVersion: entity.secretKeyVersion,
    subscribedEvents: Object.freeze([...entity.subscribedEvents]),
    consecutiveFailureCount: entity.consecutiveFailureCount,
    disabledAt: entity.disabledAt ? new Date(entity.disabledAt) : undefined,
    version: entity.version,
    createdByAdminAccountId: entity.createdByAdminAccountId,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

function toWebhookDeliveryRecord(row: WebhookDeliveryRow): WebhookDeliveryRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    endpointId: row.endpoint_id,
    eventId: row.event_id,
    eventType: row.event_type,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    nextRetryAt: row.next_retry_at ? new Date(row.next_retry_at) : undefined,
    lastResponseStatus:
      row.last_response_status === null ? undefined : Number(row.last_response_status),
    lastResponseExcerpt: row.last_response_excerpt ?? undefined,
    lastError: row.last_error ?? undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toWebhookAttemptRecord(row: WebhookAttemptRow): WebhookDeliveryAttemptRecord {
  return {
    id: row.id,
    deliveryId: row.delivery_id,
    attemptNumber: Number(row.attempt_number),
    status: row.status,
    requestBody: row.request_body,
    responseStatus: row.response_status === null ? undefined : Number(row.response_status),
    responseBodyExcerpt: row.response_body_excerpt ?? undefined,
    errorMessage: row.error_message ?? undefined,
    requestedAt: new Date(row.requested_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
  };
}

function toPublicationScheduleRecord(row: PublicationScheduleRow): PublicationScheduleRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    siteKey: row.site_key,
    siteName: row.site_name,
    contentId: row.content_id,
    contentTitle: row.content_title,
    contentSiteId: row.content_site_id,
    revisionId: row.revision_id ?? undefined,
    revisionNumber: row.revision_number === null ? undefined : Number(row.revision_number),
    action: row.action,
    scheduledFor: new Date(row.scheduled_for),
    timezone: row.timezone,
    scheduledLocalAt: row.scheduled_local_at,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    nextAttemptAt: new Date(row.next_attempt_at),
    lastError: row.last_error ?? undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : undefined,
    version: Number(row.version),
    requestedByAdminAccountId: row.requested_by_admin_account_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toPublicationScheduleRecordFromEntity(
  entity: PublicationScheduleEntity,
): PublicationScheduleRecord {
  return {
    id: entity.id,
    workspaceId: entity.workspaceId,
    siteId: entity.siteId,
    contentId: entity.contentId,
    contentSiteId: entity.contentSiteId,
    revisionId: entity.revisionId ?? undefined,
    revisionNumber: entity.revisionNumber ?? undefined,
    action: entity.action,
    scheduledFor: new Date(entity.scheduledFor),
    timezone: entity.timezone,
    scheduledLocalAt: entity.scheduledLocalAt,
    status: entity.status,
    attemptCount: entity.attemptCount,
    nextAttemptAt: new Date(entity.nextAttemptAt),
    lastError: entity.lastError ?? undefined,
    completedAt: entity.completedAt ? new Date(entity.completedAt) : undefined,
    cancelledAt: entity.cancelledAt ? new Date(entity.cancelledAt) : undefined,
    version: entity.version,
    requestedByAdminAccountId: entity.requestedByAdminAccountId,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}
