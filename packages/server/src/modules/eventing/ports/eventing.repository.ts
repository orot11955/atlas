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

import type {
  EventConsumptionOwner,
  FinishWebhookExecutionInput,
  OutboxAttemptOwner,
  WebhookAttemptOwner,
} from './eventing-attempt-owner';
export * from './eventing-attempt-owner';

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

/** Values captured from the committed start-attempt record, never from a later reload.
 * Recovery and every lifecycle change invalidate the version; retries never reset attemptCount.
 */
export interface PublicationScheduleAttemptOwner {
  scheduleId: string;
  workspaceId: string;
  attemptNumber: number;
  version: number;
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
    owner: Readonly<OutboxAttemptOwner>,
    dispatchedAt: Date,
    transaction: TTransaction,
  ): Promise<boolean>;
  rescheduleOutboxEvent(
    owner: Readonly<OutboxAttemptOwner>,
    availableAt: Date,
    errorMessage: string,
    terminal: boolean,
    updatedAt: Date,
    transaction: TTransaction,
  ): Promise<boolean>;
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
  lockEventConsumption(
    owner: Readonly<EventConsumptionOwner>,
    transaction: TTransaction,
  ): Promise<boolean>;
  completeEventConsumption(
    owner: Readonly<EventConsumptionOwner>,
    status: 'succeeded' | 'failed',
    input: Readonly<{
      processedAt: Date;
      result?: Readonly<Record<string, unknown>>;
      errorMessage?: string;
    }>,
    transaction: TTransaction,
  ): Promise<boolean>;

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
    transaction?: TTransaction,
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
  ): Promise<number>;
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
  finishWebhookDeliveryExecution(
    owner: Readonly<WebhookAttemptOwner>,
    input: Readonly<FinishWebhookExecutionInput>,
    transaction: TTransaction,
  ): Promise<boolean>;

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
  /** Atomically invalidates stale owners and returns the number of recovered rows. */
  recoverStalePublicationSchedules(
    staleBefore: Date,
    recoveredAt: Date,
    transaction: TTransaction,
  ): Promise<number>;
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
  /** False means stale ownership; callers must not write a completion Audit. */
  completePublicationSchedule(
    owner: Readonly<PublicationScheduleAttemptOwner>,
    completedAt: Date,
    transaction: TTransaction,
  ): Promise<boolean>;
  /** False means stale ownership; callers must not write a failure/retry Audit. */
  reschedulePublicationSchedule(
    owner: Readonly<PublicationScheduleAttemptOwner>,
    nextAttemptAt: Date,
    errorMessage: string,
    terminal: boolean,
    updatedAt: Date,
    transaction: TTransaction,
  ): Promise<boolean>;
}
