import type {
  ContentSiteScheduleTarget,
  EventConsumptionRecord,
  OutboxEventRecord,
  PublicationScheduleAction,
  PublicationScheduleRecord,
  WebhookDeliveryExecution,
  WebhookDeliveryRecord,
  WebhookDeliveryStatus,
  WebhookDeliveryView,
  WebhookEndpointRecord,
  WebhookEndpointStatus,
  WebhookEventType,
} from '../domain/eventing';

export type InsertOutboxEventInput = OutboxEventRecord;

export interface CreateWebhookEndpointRecordInput {
  id: string;
  workspaceId: string;
  siteId: string;
  name: string;
  url: string;
  status: WebhookEndpointStatus;
  secretCiphertext: string;
  secretKeyVersion: string;
  subscribedEvents: readonly WebhookEventType[];
  consecutiveFailureCount: number;
  version: number;
  createdByAdminAccountId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateWebhookEndpointRecordInput {
  expectedVersion: number;
  nextVersion: number;
  name: string;
  url: string;
  subscribedEvents: readonly WebhookEventType[];
  updatedAt: Date;
}

export interface RotateWebhookSecretRecordInput {
  expectedVersion: number;
  nextVersion: number;
  secretCiphertext: string;
  secretKeyVersion: string;
  updatedAt: Date;
}

export interface SetWebhookEndpointStatusRecordInput {
  expectedVersion: number;
  nextVersion: number;
  status: WebhookEndpointStatus;
  disabledAt?: Date;
  updatedAt: Date;
}

export interface InsertWebhookDeliveryInput {
  id: string;
  workspaceId: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  createdAt: Date;
}

export interface CompleteWebhookAttemptInput {
  attemptId: string;
  deliveryId: string;
  status: 'succeeded' | 'failed';
  responseStatus?: number;
  responseBodyExcerpt?: string;
  errorMessage?: string;
  completedAt: Date;
}

export interface CompleteWebhookDeliveryInput {
  status: WebhookDeliveryStatus;
  responseStatus?: number;
  responseBodyExcerpt?: string;
  errorMessage?: string;
  nextRetryAt?: Date;
  completedAt?: Date;
  updatedAt: Date;
}

export interface CreatePublicationScheduleRecordInput {
  id: string;
  workspaceId: string;
  siteId: string;
  contentId: string;
  contentSiteId: string;
  revisionId?: string;
  revisionNumber?: number;
  action: PublicationScheduleAction;
  scheduledFor: Date;
  timezone: string;
  scheduledLocalAt: string;
  requestedByAdminAccountId: string;
  createdAt: Date;
}

export interface EventingRepositoryPort<TTransaction = unknown> {
  insertOutboxEvent(input: InsertOutboxEventInput, transaction: TTransaction): Promise<void>;
  listOutboxEvents(
    workspaceId: string,
    query: Readonly<{ status?: OutboxEventRecord['status']; limit: number }>,
  ): Promise<readonly OutboxEventRecord[]>;
  findOutboxEvent(
    eventId: string,
    transaction?: TTransaction,
  ): Promise<OutboxEventRecord | undefined>;
  claimAvailableOutboxEvents(
    now: Date,
    staleBefore: Date,
    limit: number,
    transaction: TTransaction,
  ): Promise<readonly OutboxEventRecord[]>;
  markOutboxEventDispatched(
    eventId: string,
    dispatchedAt: Date,
    transaction: TTransaction,
  ): Promise<void>;
  rescheduleOutboxEvent(
    eventId: string,
    availableAt: Date,
    errorMessage: string,
    terminal: boolean,
    updatedAt: Date,
    transaction: TTransaction,
  ): Promise<void>;
  retryDeadOutboxEvent(
    workspaceId: string,
    eventId: string,
    availableAt: Date,
    transaction: TTransaction,
  ): Promise<boolean>;
  claimEventConsumption(
    eventId: string,
    consumerKey: string,
    claimedAt: Date,
    staleBefore: Date,
    transaction: TTransaction,
  ): Promise<EventConsumptionRecord | undefined>;
  completeEventConsumption(
    consumptionId: string,
    status: 'succeeded' | 'failed',
    input: Readonly<{
      processedAt: Date;
      result?: Readonly<Record<string, unknown>>;
      errorMessage?: string;
    }>,
    transaction: TTransaction,
  ): Promise<void>;

  findSite(
    workspaceId: string,
    siteId: string,
    transaction?: TTransaction,
  ): Promise<{ id: string; key: string; name: string; status: string } | undefined>;
  listWebhookEndpoints(
    workspaceId: string,
    siteId?: string,
  ): Promise<readonly WebhookEndpointRecord[]>;
  findWebhookEndpointForUpdate(
    workspaceId: string,
    endpointId: string,
    transaction: TTransaction,
  ): Promise<WebhookEndpointRecord | undefined>;
  insertWebhookEndpoint(
    input: CreateWebhookEndpointRecordInput,
    transaction: TTransaction,
  ): Promise<void>;
  updateWebhookEndpoint(
    workspaceId: string,
    endpointId: string,
    input: UpdateWebhookEndpointRecordInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  rotateWebhookSecret(
    workspaceId: string,
    endpointId: string,
    input: RotateWebhookSecretRecordInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  setWebhookEndpointStatus(
    workspaceId: string,
    endpointId: string,
    input: SetWebhookEndpointStatusRecordInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  listActiveWebhookEndpointsForEvent(
    workspaceId: string,
    siteId: string,
    eventType: WebhookEventType,
    occurredAt: Date,
  ): Promise<readonly WebhookEndpointRecord[]>;
  insertWebhookDeliveryIfAbsent(
    input: InsertWebhookDeliveryInput,
    transaction: TTransaction,
  ): Promise<WebhookDeliveryRecord>;
  listWebhookDeliveries(
    workspaceId: string,
    query: Readonly<{
      endpointId?: string;
      status?: WebhookDeliveryStatus;
      limit: number;
    }>,
  ): Promise<readonly WebhookDeliveryView[]>;
  recoverStaleWebhookDeliveries(
    staleBefore: Date,
    recoveredAt: Date,
    transaction: TTransaction,
  ): Promise<void>;
  listDueWebhookDeliveries(now: Date, limit: number): Promise<readonly WebhookDeliveryRecord[]>;
  findWebhookDeliveryForUpdate(
    workspaceId: string,
    deliveryId: string,
    transaction: TTransaction,
  ): Promise<WebhookDeliveryRecord | undefined>;
  resetWebhookDeliveryForRetry(
    workspaceId: string,
    deliveryId: string,
    updatedAt: Date,
    transaction: TTransaction,
  ): Promise<boolean>;
  startWebhookDeliveryAttempt(
    deliveryId: string,
    attempt: Readonly<{ id: string; attemptNumber: number; requestedAt: Date }>,
    transaction: TTransaction,
  ): Promise<WebhookDeliveryExecution | undefined>;
  completeWebhookDeliveryAttempt(
    input: CompleteWebhookAttemptInput,
    transaction: TTransaction,
  ): Promise<void>;
  completeWebhookDelivery(
    deliveryId: string,
    input: CompleteWebhookDeliveryInput,
    transaction: TTransaction,
  ): Promise<void>;
  resetWebhookEndpointFailures(
    endpointId: string,
    updatedAt: Date,
    transaction: TTransaction,
  ): Promise<void>;
  incrementWebhookEndpointFailures(
    endpointId: string,
    threshold: number,
    updatedAt: Date,
    transaction: TTransaction,
  ): Promise<{ failureCount: number; disabled: boolean }>;

  findContentSiteScheduleTarget(
    workspaceId: string,
    contentId: string,
    contentSiteId: string,
    transaction: TTransaction,
  ): Promise<ContentSiteScheduleTarget | undefined>;
  insertPublicationSchedule(
    input: CreatePublicationScheduleRecordInput,
    transaction: TTransaction,
  ): Promise<void>;
  listPublicationSchedules(
    workspaceId: string,
    query: Readonly<{ contentId?: string; contentSiteId?: string; limit: number }>,
  ): Promise<readonly PublicationScheduleRecord[]>;
  recoverStalePublicationSchedules(
    staleBefore: Date,
    recoveredAt: Date,
    transaction: TTransaction,
  ): Promise<void>;
  listDuePublicationSchedules(
    now: Date,
    limit: number,
  ): Promise<readonly PublicationScheduleRecord[]>;
  findPublicationScheduleForUpdate(
    workspaceId: string,
    scheduleId: string,
    transaction: TTransaction,
  ): Promise<PublicationScheduleRecord | undefined>;
  cancelPublicationSchedule(
    workspaceId: string,
    scheduleId: string,
    expectedVersion: number,
    cancelledAt: Date,
    transaction: TTransaction,
  ): Promise<boolean>;
  retryPublicationSchedule(
    workspaceId: string,
    scheduleId: string,
    expectedVersion: number,
    retriedAt: Date,
    transaction: TTransaction,
  ): Promise<boolean>;
  startPublicationScheduleAttempt(
    scheduleId: string,
    attemptNumber: number,
    startedAt: Date,
    transaction: TTransaction,
  ): Promise<PublicationScheduleRecord | undefined>;
  completePublicationSchedule(
    scheduleId: string,
    completedAt: Date,
    transaction: TTransaction,
  ): Promise<void>;
  reschedulePublicationSchedule(
    scheduleId: string,
    nextAttemptAt: Date,
    errorMessage: string,
    terminal: boolean,
    updatedAt: Date,
    transaction: TTransaction,
  ): Promise<void>;
}
