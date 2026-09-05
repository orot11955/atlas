import { createAdminApiClient } from '../../lib/api';
import type {
  ApiEnvelope,
  OutboxEvent,
  PublicationSchedule,
  PublicationScheduleAction,
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEndpoint,
  WebhookEndpointSecretResult,
  WebhookEventType,
} from './eventing-types';

function client() {
  return createAdminApiClient();
}

export async function loadWebhookEndpoints(siteId?: string): Promise<readonly WebhookEndpoint[]> {
  const query = new URLSearchParams();
  if (siteId) query.set('siteId', siteId);
  const suffix = query.toString();
  const response = await client().get<ApiEnvelope<{ items: readonly WebhookEndpoint[] }>>(
    `/webhook-endpoints${suffix ? `?${suffix}` : ''}`,
  );
  return response.data.items;
}

export async function createWebhookEndpoint(input: {
  siteId: string;
  name: string;
  url: string;
  subscribedEvents: readonly WebhookEventType[];
}): Promise<WebhookEndpointSecretResult> {
  const response = await client().post<ApiEnvelope<WebhookEndpointSecretResult>>(
    '/webhook-endpoints',
    input,
  );
  return response.data;
}

export async function updateWebhookEndpoint(
  endpointId: string,
  input: {
    version: number;
    name: string;
    url: string;
    subscribedEvents: readonly WebhookEventType[];
  },
): Promise<WebhookEndpoint> {
  const response = await client().patch<ApiEnvelope<WebhookEndpoint>>(
    `/webhook-endpoints/${encodeURIComponent(endpointId)}`,
    input,
  );
  return response.data;
}

export async function rotateWebhookSecret(
  endpointId: string,
  version: number,
): Promise<WebhookEndpointSecretResult> {
  const response = await client().post<ApiEnvelope<WebhookEndpointSecretResult>>(
    `/webhook-endpoints/${encodeURIComponent(endpointId)}/secret/rotate`,
    { version },
  );
  return response.data;
}

export async function setWebhookEndpointEnabled(
  endpointId: string,
  version: number,
  enabled: boolean,
): Promise<WebhookEndpoint> {
  const response = await client().post<ApiEnvelope<WebhookEndpoint>>(
    `/webhook-endpoints/${encodeURIComponent(endpointId)}/${enabled ? 'enable' : 'disable'}`,
    { version },
  );
  return response.data;
}

export async function loadWebhookDeliveries(
  input: {
    endpointId?: string;
    status?: WebhookDeliveryStatus;
    limit?: number;
  } = {},
): Promise<readonly WebhookDelivery[]> {
  const query = new URLSearchParams();
  if (input.endpointId) query.set('endpointId', input.endpointId);
  if (input.status) query.set('status', input.status);
  if (input.limit) query.set('limit', String(input.limit));
  const suffix = query.toString();
  const response = await client().get<ApiEnvelope<{ items: readonly WebhookDelivery[] }>>(
    `/webhook-deliveries${suffix ? `?${suffix}` : ''}`,
  );
  return response.data.items;
}

export async function retryWebhookDelivery(
  deliveryId: string,
): Promise<{ deliveryId: string; attemptNumber: number }> {
  const response = await client().post<ApiEnvelope<{ deliveryId: string; attemptNumber: number }>>(
    `/webhook-deliveries/${encodeURIComponent(deliveryId)}/retry`,
  );
  return response.data;
}

export async function loadOutboxEvents(limit = 50): Promise<readonly OutboxEvent[]> {
  const response = await client().get<ApiEnvelope<{ items: readonly OutboxEvent[] }>>(
    `/eventing/outbox?limit=${encodeURIComponent(String(limit))}`,
  );
  return response.data.items;
}

export async function retryOutboxEvent(eventId: string): Promise<void> {
  await client().post(`/eventing/outbox/${encodeURIComponent(eventId)}/retry`);
}

export async function loadPublicationSchedules(
  input: {
    contentId?: string;
    contentSiteId?: string;
    limit?: number;
  } = {},
): Promise<readonly PublicationSchedule[]> {
  const query = new URLSearchParams();
  if (input.contentId) query.set('contentId', input.contentId);
  if (input.contentSiteId) query.set('contentSiteId', input.contentSiteId);
  if (input.limit) query.set('limit', String(input.limit));
  const suffix = query.toString();
  const response = await client().get<ApiEnvelope<{ items: readonly PublicationSchedule[] }>>(
    `/publication-schedules${suffix ? `?${suffix}` : ''}`,
  );
  return response.data.items;
}

export async function createPublicationSchedule(
  contentId: string,
  contentSiteId: string,
  input: {
    action: PublicationScheduleAction;
    scheduledLocalAt: string;
    timezone?: string;
  },
): Promise<PublicationSchedule> {
  const response = await client().post<ApiEnvelope<PublicationSchedule>>(
    `/contents/${encodeURIComponent(contentId)}/sites/${encodeURIComponent(contentSiteId)}/schedules`,
    input,
  );
  return response.data;
}

export async function cancelPublicationSchedule(
  scheduleId: string,
  version: number,
): Promise<PublicationSchedule> {
  const response = await client().post<ApiEnvelope<PublicationSchedule>>(
    `/publication-schedules/${encodeURIComponent(scheduleId)}/cancel`,
    { version },
  );
  return response.data;
}

export async function retryPublicationSchedule(
  scheduleId: string,
  version: number,
): Promise<PublicationSchedule> {
  const response = await client().post<ApiEnvelope<PublicationSchedule>>(
    `/publication-schedules/${encodeURIComponent(scheduleId)}/retry`,
    { version },
  );
  return response.data;
}
