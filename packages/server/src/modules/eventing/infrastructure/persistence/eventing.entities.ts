import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type {
  EventConsumptionStatus,
  OutboxEventEnvelope,
  OutboxEventStatus,
  PublicationScheduleAction,
  PublicationScheduleStatus,
  WebhookDeliveryAttemptStatus,
  WebhookDeliveryStatus,
  WebhookEndpointStatus,
  WebhookEventType,
} from '../../domain/eventing';

@Entity({ name: 'outbox_events' })
@Index('idx_outbox_events_workspace_created', ['workspaceId', 'createdAt'])
export class OutboxEventEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ name: 'site_id', type: 'uuid', nullable: true })
  public siteId!: string | null;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 80 })
  public aggregateType!: string;

  @Column({ name: 'aggregate_id', type: 'uuid' })
  public aggregateId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 120 })
  public eventType!: string;

  @Column({ name: 'schema_version', type: 'integer', default: 1 })
  public schemaVersion!: number;

  @Column({ name: 'payload_json', type: 'jsonb' })
  public payloadJson!: OutboxEventEnvelope;

  @Column({ type: 'varchar', length: 16 })
  public status!: OutboxEventStatus;

  @Column({ name: 'available_at', type: 'timestamptz' })
  public availableAt!: Date;

  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  public claimedAt!: Date | null;

  @Column({ name: 'dispatched_at', type: 'timestamptz', nullable: true })
  public dispatchedAt!: Date | null;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  public attemptCount!: number;

  @Column({ name: 'last_error', type: 'varchar', length: 1000, nullable: true })
  public lastError!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}

@Entity({ name: 'event_consumptions' })
@Index('uq_event_consumptions_consumer_event', ['consumerKey', 'eventId'], { unique: true })
@Index('idx_event_consumptions_status_updated', ['status', 'updatedAt'])
export class EventConsumptionEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'consumer_key', type: 'varchar', length: 120 })
  public consumerKey!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  public eventId!: string;

  @Column({ type: 'varchar', length: 16 })
  public status!: EventConsumptionStatus;

  @Column({ name: 'attempt_count', type: 'integer', default: 1 })
  public attemptCount!: number;

  @Column({ name: 'claimed_at', type: 'timestamptz' })
  public claimedAt!: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  public processedAt!: Date | null;

  @Column({ name: 'result_json', type: 'jsonb', nullable: true })
  public resultJson!: Record<string, unknown> | null;

  @Column({ name: 'last_error', type: 'varchar', length: 1000, nullable: true })
  public lastError!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}

@Entity({ name: 'webhook_endpoints' })
@Index('uq_webhook_endpoints_site_url', ['workspaceId', 'siteId', 'url'], { unique: true })
@Index('idx_webhook_endpoints_site_status', ['workspaceId', 'siteId', 'status', 'createdAt'])
export class WebhookEndpointEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  public siteId!: string;

  @Column({ type: 'varchar', length: 120 })
  public name!: string;

  @Column({ type: 'varchar', length: 2048 })
  public url!: string;

  @Column({ type: 'varchar', length: 16 })
  public status!: WebhookEndpointStatus;

  @Column({ name: 'secret_ciphertext', type: 'text' })
  public secretCiphertext!: string;

  @Column({ name: 'secret_key_version', type: 'varchar', length: 64 })
  public secretKeyVersion!: string;

  @Column({ name: 'subscribed_events', type: 'text', array: true })
  public subscribedEvents!: WebhookEventType[];

  @Column({ name: 'consecutive_failure_count', type: 'integer', default: 0 })
  public consecutiveFailureCount!: number;

  @Column({ name: 'disabled_at', type: 'timestamptz', nullable: true })
  public disabledAt!: Date | null;

  @Column({ type: 'integer', default: 1 })
  public version!: number;

  @Column({ name: 'created_by_admin_account_id', type: 'uuid' })
  public createdByAdminAccountId!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}

@Entity({ name: 'webhook_deliveries' })
@Index('uq_webhook_deliveries_endpoint_event', ['endpointId', 'eventId'], { unique: true })
@Index('idx_webhook_deliveries_workspace_created', ['workspaceId', 'createdAt'])
@Index('idx_webhook_deliveries_endpoint_created', ['endpointId', 'createdAt'])
export class WebhookDeliveryEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ name: 'endpoint_id', type: 'uuid' })
  public endpointId!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  public eventId!: string;

  @Column({ type: 'varchar', length: 24 })
  public status!: WebhookDeliveryStatus;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  public attemptCount!: number;

  @Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true })
  public nextRetryAt!: Date | null;

  @Column({ name: 'last_response_status', type: 'integer', nullable: true })
  public lastResponseStatus!: number | null;

  @Column({ name: 'last_response_excerpt', type: 'varchar', length: 2000, nullable: true })
  public lastResponseExcerpt!: string | null;

  @Column({ name: 'last_error', type: 'varchar', length: 1000, nullable: true })
  public lastError!: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  public completedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}

@Entity({ name: 'webhook_delivery_attempts' })
@Index('uq_webhook_delivery_attempts_number', ['deliveryId', 'attemptNumber'], { unique: true })
export class WebhookDeliveryAttemptEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'delivery_id', type: 'uuid' })
  public deliveryId!: string;

  @Column({ name: 'attempt_number', type: 'integer' })
  public attemptNumber!: number;

  @Column({ type: 'varchar', length: 16 })
  public status!: WebhookDeliveryAttemptStatus;

  @Column({ name: 'request_body', type: 'text' })
  public requestBody!: string;

  @Column({ name: 'response_status', type: 'integer', nullable: true })
  public responseStatus!: number | null;

  @Column({ name: 'response_body_excerpt', type: 'varchar', length: 2000, nullable: true })
  public responseBodyExcerpt!: string | null;

  @Column({ name: 'error_message', type: 'varchar', length: 1000, nullable: true })
  public errorMessage!: string | null;

  @Column({ name: 'requested_at', type: 'timestamptz' })
  public requestedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  public completedAt!: Date | null;
}

@Entity({ name: 'publication_schedules' })
@Index('idx_publication_schedules_content_site', ['workspaceId', 'contentSiteId', 'createdAt'])
export class PublicationScheduleEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  public siteId!: string;

  @Column({ name: 'content_id', type: 'uuid' })
  public contentId!: string;

  @Column({ name: 'content_site_id', type: 'uuid' })
  public contentSiteId!: string;

  @Column({ name: 'revision_id', type: 'uuid', nullable: true })
  public revisionId!: string | null;

  @Column({ name: 'revision_number', type: 'integer', nullable: true })
  public revisionNumber!: number | null;

  @Column({ type: 'varchar', length: 16 })
  public action!: PublicationScheduleAction;

  @Column({ name: 'scheduled_for', type: 'timestamptz' })
  public scheduledFor!: Date;

  @Column({ type: 'varchar', length: 64 })
  public timezone!: string;

  @Column({ name: 'scheduled_local_at', type: 'varchar', length: 32 })
  public scheduledLocalAt!: string;

  @Column({ type: 'varchar', length: 16 })
  public status!: PublicationScheduleStatus;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  public attemptCount!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  public nextAttemptAt!: Date;

  @Column({ name: 'last_error', type: 'varchar', length: 1000, nullable: true })
  public lastError!: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  public completedAt!: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  public cancelledAt!: Date | null;

  @Column({ type: 'integer', default: 1 })
  public version!: number;

  @Column({ name: 'requested_by_admin_account_id', type: 'uuid' })
  public requestedByAdminAccountId!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
