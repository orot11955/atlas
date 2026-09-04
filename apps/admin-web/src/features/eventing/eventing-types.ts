export type WebhookEventType = 'content.published' | 'content.unpublished';
export type WebhookEndpointStatus = 'active' | 'disabled';
export type WebhookDeliveryStatus =
  'pending' | 'processing' | 'retry_scheduled' | 'succeeded' | 'dead';
export type OutboxEventStatus = 'pending' | 'processing' | 'dispatched' | 'dead';
export type PublicationScheduleAction = 'publish' | 'withdraw';
export type PublicationScheduleStatus =
  'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface ApiEnvelope<T> {
  data: T;
}

export interface WebhookEndpoint {
  id: string;
  workspaceId: string;
  siteId: string;
  siteKey?: string;
  siteName?: string;
  name: string;
  url: string;
  status: WebhookEndpointStatus;
  subscribedEvents: readonly WebhookEventType[];
  consecutiveFailureCount: number;
  disabledAt?: string;
  version: number;
  createdByAdminAccountId: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookEndpointSecretResult {
  endpoint: WebhookEndpoint;
  secret: string;
}

export interface WebhookDeliveryAttempt {
  id: string;
  attemptNumber: number;
  status: 'processing' | 'succeeded' | 'failed';
  responseStatus?: number;
  responseBodyExcerpt?: string;
  errorMessage?: string;
  requestedAt: string;
  completedAt?: string;
}

export interface WebhookDelivery {
  id: string;
  workspaceId: string;
  siteId: string;
  endpointId: string;
  endpointName: string;
  endpointUrl: string;
  eventId: string;
  eventType: string;
  status: WebhookDeliveryStatus;
  attemptCount: number;
  nextRetryAt?: string;
  lastResponseStatus?: number;
  lastResponseExcerpt?: string;
  lastError?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  attempts: readonly WebhookDeliveryAttempt[];
}

export interface OutboxEvent {
  id: string;
  workspaceId: string;
  siteId?: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  schemaVersion: number;
  status: OutboxEventStatus;
  availableAt: string;
  claimedAt?: string;
  dispatchedAt?: string;
  attemptCount: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicationSchedule {
  id: string;
  workspaceId: string;
  siteId: string;
  siteKey?: string;
  siteName?: string;
  contentId: string;
  contentTitle?: string;
  contentSiteId: string;
  action: PublicationScheduleAction;
  scheduledFor: string;
  timezone: string;
  scheduledLocalAt: string;
  status: PublicationScheduleStatus;
  attemptCount: number;
  nextAttemptAt: string;
  lastError?: string;
  completedAt?: string;
  cancelledAt?: string;
  version: number;
  requestedByAdminAccountId: string;
  createdAt: string;
  updatedAt: string;
}

export const WEBHOOK_EVENT_OPTIONS: readonly Readonly<{
  value: WebhookEventType;
  label: string;
}>[] = Object.freeze([
  { value: 'content.published', label: 'Content Published' },
  { value: 'content.unpublished', label: 'Content Unpublished' },
]);
