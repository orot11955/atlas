import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

import { DomainError, ErrorCode, isUuidV7 } from '../../../core';

export const OutboxEventStatus = {
  DEAD: 'dead',
  DISPATCHED: 'dispatched',
  PENDING: 'pending',
  PROCESSING: 'processing',
} as const;

export const EventConsumptionStatus = {
  FAILED: 'failed',
  PROCESSING: 'processing',
  SUCCEEDED: 'succeeded',
} as const;

export type EventConsumptionStatus =
  (typeof EventConsumptionStatus)[keyof typeof EventConsumptionStatus];

export type OutboxEventStatus = (typeof OutboxEventStatus)[keyof typeof OutboxEventStatus];

export const WebhookEndpointStatus = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
} as const;

export type WebhookEndpointStatus =
  (typeof WebhookEndpointStatus)[keyof typeof WebhookEndpointStatus];

export const WebhookDeliveryStatus = {
  DEAD: 'dead',
  PENDING: 'pending',
  PROCESSING: 'processing',
  RETRY_SCHEDULED: 'retry_scheduled',
  SUCCEEDED: 'succeeded',
} as const;

export type WebhookDeliveryStatus =
  (typeof WebhookDeliveryStatus)[keyof typeof WebhookDeliveryStatus];

export const WebhookDeliveryAttemptStatus = {
  FAILED: 'failed',
  PROCESSING: 'processing',
  SUCCEEDED: 'succeeded',
} as const;

export type WebhookDeliveryAttemptStatus =
  (typeof WebhookDeliveryAttemptStatus)[keyof typeof WebhookDeliveryAttemptStatus];

export const PublicationScheduleAction = {
  PUBLISH: 'publish',
  WITHDRAW: 'withdraw',
} as const;

export type PublicationScheduleAction =
  (typeof PublicationScheduleAction)[keyof typeof PublicationScheduleAction];

export const PublicationScheduleStatus = {
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  FAILED: 'failed',
  PENDING: 'pending',
  PROCESSING: 'processing',
} as const;

export type PublicationScheduleStatus =
  (typeof PublicationScheduleStatus)[keyof typeof PublicationScheduleStatus];

export const EventType = {
  CONTENT_PUBLISHED: 'content.published',
  CONTENT_UNPUBLISHED: 'content.unpublished',
  PUBLICATION_SCHEDULE_REQUESTED: 'publication.schedule.requested',
  PUBLICATION_SCHEDULE_RETRY_REQUESTED: 'publication.schedule.retry-requested',
  WEBHOOK_DELIVERY_RETRY_REQUESTED: 'webhook.delivery.retry-requested',
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

export const WEBHOOK_EVENT_TYPES = Object.freeze([
  EventType.CONTENT_PUBLISHED,
  EventType.CONTENT_UNPUBLISHED,
]) as readonly WebhookEventType[];

export type WebhookEventType =
  typeof EventType.CONTENT_PUBLISHED | typeof EventType.CONTENT_UNPUBLISHED;

export const EVENT_SCHEMA_VERSION = 1;
export const WEBHOOK_SIGNATURE_VERSION = 'v1';
export const WEBHOOK_RETRY_DELAYS_MS = Object.freeze([
  60_000, 300_000, 1_800_000, 7_200_000, 43_200_000,
]) as readonly number[];
export const PUBLICATION_SCHEDULE_RETRY_DELAYS_MS = Object.freeze([
  60_000, 300_000, 1_800_000,
]) as readonly number[];

export interface OutboxEventEnvelope {
  eventId: string;
  eventType: string;
  occurredAt: string;
  workspaceId: string;
  siteId: string | null;
  aggregateId: string;
  schemaVersion: number;
  data: Readonly<Record<string, unknown>>;
}

export interface OutboxEventRecord {
  id: string;
  workspaceId: string;
  siteId?: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  schemaVersion: number;
  payload: Readonly<OutboxEventEnvelope>;
  status: OutboxEventStatus;
  availableAt: Date;
  claimedAt?: Date;
  dispatchedAt?: Date;
  attemptCount: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventConsumptionRecord {
  id: string;
  consumerKey: string;
  eventId: string;
  status: EventConsumptionStatus;
  attemptCount: number;
  claimedAt: Date;
  processedAt?: Date;
  result?: Readonly<Record<string, unknown>>;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookEndpointRecord {
  id: string;
  workspaceId: string;
  siteId: string;
  siteKey?: string;
  siteName?: string;
  name: string;
  url: string;
  status: WebhookEndpointStatus;
  secretCiphertext: string;
  secretKeyVersion: string;
  subscribedEvents: readonly WebhookEventType[];
  consecutiveFailureCount: number;
  disabledAt?: Date;
  version: number;
  createdByAdminAccountId: string;
  createdAt: Date;
  updatedAt: Date;
}

export type WebhookEndpointView = Omit<
  WebhookEndpointRecord,
  'secretCiphertext' | 'secretKeyVersion'
>;

export interface WebhookDeliveryRecord {
  id: string;
  workspaceId: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  status: WebhookDeliveryStatus;
  attemptCount: number;
  nextRetryAt?: Date;
  lastResponseStatus?: number;
  lastResponseExcerpt?: string;
  lastError?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDeliveryAttemptRecord {
  id: string;
  deliveryId: string;
  attemptNumber: number;
  status: WebhookDeliveryAttemptStatus;
  requestBody: string;
  responseStatus?: number;
  responseBodyExcerpt?: string;
  errorMessage?: string;
  requestedAt: Date;
  completedAt?: Date;
}

export interface WebhookDeliveryView extends WebhookDeliveryRecord {
  endpointName: string;
  endpointUrl: string;
  siteId: string;
  attempts: readonly WebhookDeliveryAttemptRecord[];
}

export interface WebhookDeliveryExecution {
  delivery: WebhookDeliveryRecord;
  endpoint: WebhookEndpointRecord;
  event: OutboxEventRecord;
  attempt: WebhookDeliveryAttemptRecord;
}

export interface PublicationScheduleRecord {
  id: string;
  workspaceId: string;
  siteId: string;
  siteKey?: string;
  siteName?: string;
  contentId: string;
  contentTitle?: string;
  contentSiteId: string;
  revisionId?: string;
  revisionNumber?: number;
  action: PublicationScheduleAction;
  scheduledFor: Date;
  timezone: string;
  scheduledLocalAt: string;
  status: PublicationScheduleStatus;
  attemptCount: number;
  nextAttemptAt: Date;
  lastError?: string;
  completedAt?: Date;
  cancelledAt?: Date;
  version: number;
  requestedByAdminAccountId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentSiteScheduleTarget {
  workspaceId: string;
  siteId: string;
  siteStatus: string;
  siteTimezone: string;
  contentId: string;
  contentStatus: string;
  contentSiteId: string;
  readyRevisionId?: string;
  readyRevisionNumber?: number;
  activePublicationId?: string;
}

export function isWebhookEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

export function normalizeWebhookEventTypes(values: readonly string[]): readonly WebhookEventType[] {
  const normalized = [...new Set(values.map((value) => value.trim().toLowerCase()))];

  if (normalized.length < 1 || normalized.length > 32) {
    throw validationError('subscribedEvents', 'At least one Webhook event must be selected.');
  }

  for (const value of normalized) {
    if (!isWebhookEventType(value)) {
      throw validationError('subscribedEvents', `Unsupported Webhook event type: ${value}`);
    }
  }

  return Object.freeze(normalized as WebhookEventType[]);
}

export function normalizeWebhookName(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');

  if (normalized.length < 1 || normalized.length > 120) {
    throw validationError('name', 'Webhook name must contain between 1 and 120 characters.');
  }

  return normalized;
}

export function normalizeWebhookUrl(
  value: string,
  options: Readonly<{ allowHttp: boolean; allowPrivateNetwork: boolean }>,
): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw validationError('url', 'Webhook URL must be an absolute URL.');
  }

  const protocolAllowed =
    url.protocol === 'https:' || (options.allowHttp && url.protocol === 'http:');

  if (!protocolAllowed) {
    throw validationError('url', 'Webhook URL must use HTTPS.');
  }

  if (url.username || url.password || url.hash) {
    throw validationError('url', 'Webhook URL cannot include credentials or a fragment.');
  }

  if (url.toString().length > 2_048) {
    throw validationError('url', 'Webhook URL cannot exceed 2048 characters.');
  }

  if (!options.allowPrivateNetwork && isPrivateHostname(url.hostname)) {
    throw validationError('url', 'Webhook URL cannot target a loopback or private network host.');
  }

  url.username = '';
  url.password = '';
  url.hash = '';

  return url.toString();
}

export function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');

  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true;
  }

  const family = isIP(normalized);

  if (family === 4) {
    return !isPublicIpv4(normalized);
  }

  if (family === 6) {
    return !isPublicIpv6(normalized);
  }

  return false;
}

function isPublicIpv4(address: string): boolean {
  const [first = -1, second = -1, third = -1] = address.split('.').map(Number);

  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isPublicIpv6(address: string): boolean {
  const bytes = parseIpv6Bytes(address);

  if (!bytes) {
    return false;
  }

  // Public IPv6 unicast is currently allocated from 2000::/3. Restricting
  // Webhooks to that range avoids loopback, link-local, ULA, multicast,
  // IPv4-mapped and other special-purpose address classes.
  const globallyRouted = (bytes[0] ?? 0) >= 0x20 && (bytes[0] ?? 0) <= 0x3f;
  const documentationRange =
    bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8;

  return globallyRouted && !documentationRange;
}

function parseIpv6Bytes(address: string): readonly number[] | undefined {
  const pieces = address.split('::');

  if (pieces.length > 2) {
    return undefined;
  }

  const left = parseIpv6Section(pieces[0] ?? '');
  const right = parseIpv6Section(pieces[1] ?? '');

  if (!left || !right) {
    return undefined;
  }

  const missing = 8 - left.length - right.length;
  if ((pieces.length === 1 && missing !== 0) || (pieces.length === 2 && missing < 1)) {
    return undefined;
  }

  const groups = [...left, ...Array.from({ length: Math.max(0, missing) }, () => 0), ...right];
  if (groups.length !== 8) {
    return undefined;
  }

  return Object.freeze(groups.flatMap((group) => [(group >> 8) & 0xff, group & 0xff]));
}

function parseIpv6Section(section: string): number[] | undefined {
  if (!section) {
    return [];
  }

  const tokens = section.split(':');
  const groups: number[] = [];

  for (const [index, token] of tokens.entries()) {
    if (token.includes('.')) {
      if (index !== tokens.length - 1 || isIP(token) !== 4) {
        return undefined;
      }

      const octets = token.split('.').map(Number);
      groups.push(((octets[0] ?? 0) << 8) | (octets[1] ?? 0));
      groups.push(((octets[2] ?? 0) << 8) | (octets[3] ?? 0));
      continue;
    }

    if (!/^[a-f0-9]{1,4}$/u.test(token)) {
      return undefined;
    }

    groups.push(Number.parseInt(token, 16));
  }

  return groups;
}

export function normalizePublicationScheduleAction(value: string): PublicationScheduleAction {
  if (value === PublicationScheduleAction.PUBLISH || value === PublicationScheduleAction.WITHDRAW) {
    return value;
  }

  throw validationError('action', 'Publication schedule action must be publish or withdraw.');
}

export function normalizeScheduledFor(value: Date, now: Date): Date {
  const scheduledFor = new Date(value);
  const minimum = now.getTime() + 30_000;
  const maximum = now.getTime() + 366 * 24 * 60 * 60 * 1_000;

  if (Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() < minimum) {
    throw validationError(
      'scheduledFor',
      'Publication schedule must be at least 30 seconds ahead.',
    );
  }

  if (scheduledFor.getTime() > maximum) {
    throw validationError(
      'scheduledFor',
      'Publication schedule cannot be more than one year ahead.',
    );
  }

  return scheduledFor;
}

export function assertContentSiteSchedulable(
  target: ContentSiteScheduleTarget,
  action: PublicationScheduleAction,
): void {
  if (target.siteStatus !== 'active') {
    throw new DomainError({
      code: ErrorCode.INVALID_STATE_TRANSITION,
      message: 'Publication scheduling requires an active Site.',
    });
  }

  if (action === PublicationScheduleAction.PUBLISH && target.contentStatus !== 'ready') {
    throw new DomainError({
      code: ErrorCode.INVALID_STATE_TRANSITION,
      message: 'A READY Content Revision is required before scheduling publication.',
    });
  }

  if (action === PublicationScheduleAction.WITHDRAW && !target.activePublicationId) {
    throw new DomainError({
      code: ErrorCode.INVALID_STATE_TRANSITION,
      message: 'An active Publication is required before scheduling withdrawal.',
    });
  }
}

export function createWebhookSignature(
  secret: string,
  timestamp: string,
  eventId: string,
  body: string,
): string {
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new RangeError('Webhook secret must contain at least 32 bytes.');
  }

  const digest = createHmac('sha256', secret)
    .update(timestamp, 'utf8')
    .update('.', 'utf8')
    .update(eventId, 'utf8')
    .update('.', 'utf8')
    .update(body, 'utf8')
    .digest('hex');

  return `${WEBHOOK_SIGNATURE_VERSION}=${digest}`;
}

export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  eventId: string,
  body: string,
  signature: string,
): boolean {
  const expected = Buffer.from(createWebhookSignature(secret, timestamp, eventId, body), 'utf8');
  const actual = Buffer.from(signature, 'utf8');

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function retryAt(
  attemptedAt: Date,
  attemptNumber: number,
  delays: readonly number[],
): Date | undefined {
  const delay = delays[attemptNumber - 1];
  return delay === undefined ? undefined : new Date(attemptedAt.getTime() + delay);
}

export function assertUuidV7(value: string, field: string): void {
  if (!isUuidV7(value)) {
    throw validationError(field, `${field} must be a UUIDv7.`);
  }
}

export function truncateOperationalMessage(value: unknown, maximum = 1_000): string {
  const message = value instanceof Error ? value.message : String(value);
  return (
    message
      .replace(/[\r\n\t]+/gu, ' ')
      .trim()
      .slice(0, maximum) || 'Unknown failure.'
  );
}

export function freezeOutboxEvent(record: OutboxEventRecord): Readonly<OutboxEventRecord> {
  return Object.freeze({
    ...record,
    payload: Object.freeze({
      ...record.payload,
      data: Object.freeze({ ...record.payload.data }),
    }),
    availableAt: new Date(record.availableAt),
    claimedAt: record.claimedAt ? new Date(record.claimedAt) : undefined,
    dispatchedAt: record.dispatchedAt ? new Date(record.dispatchedAt) : undefined,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  });
}

export function freezeWebhookEndpoint(
  record: WebhookEndpointRecord,
): Readonly<WebhookEndpointRecord> {
  return Object.freeze({
    ...record,
    subscribedEvents: Object.freeze([...record.subscribedEvents]),
    disabledAt: record.disabledAt ? new Date(record.disabledAt) : undefined,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  });
}

export function toWebhookEndpointView(
  record: WebhookEndpointRecord,
): Readonly<WebhookEndpointView> {
  const {
    secretCiphertext: _secretCiphertext,
    secretKeyVersion: _secretKeyVersion,
    ...view
  } = record;
  return Object.freeze({
    ...view,
    subscribedEvents: Object.freeze([...record.subscribedEvents]),
    disabledAt: record.disabledAt ? new Date(record.disabledAt) : undefined,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  });
}

function validationError(field: string, message: string): DomainError {
  return new DomainError({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { field },
  });
}

export function normalizeTimezone(value: string): string {
  const normalized = value.trim();

  if (normalized.length < 1 || normalized.length > 64) {
    throw validationError('timezone', 'Timezone must contain between 1 and 64 characters.');
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date(0));
  } catch {
    throw validationError('timezone', 'Timezone must be a valid IANA timezone.');
  }

  return normalized;
}

export function localDateTimeToUtc(value: string, timezoneValue: string): Date {
  const timezone = normalizeTimezone(timezoneValue);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(value.trim());

  if (!match) {
    throw validationError(
      'scheduledLocalAt',
      'Local schedule time must use YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss.',
    );
  }

  const [, yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue = '00'] = match;
  const expected = {
    year: Number(yearValue),
    month: Number(monthValue),
    day: Number(dayValue),
    hour: Number(hourValue),
    minute: Number(minuteValue),
    second: Number(secondValue),
  };

  if (
    expected.month < 1 ||
    expected.month > 12 ||
    expected.day < 1 ||
    expected.day > 31 ||
    expected.hour > 23 ||
    expected.minute > 59 ||
    expected.second > 59
  ) {
    throw validationError('scheduledLocalAt', 'Local schedule time contains an invalid date.');
  }

  let timestamp = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
    expected.second,
  );

  // Resolve the timezone offset without relying on host TZ. Two passes handle DST boundaries.
  for (let index = 0; index < 3; index += 1) {
    const actual = readZonedParts(new Date(timestamp), timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const expectedAsUtc = Date.UTC(
      expected.year,
      expected.month - 1,
      expected.day,
      expected.hour,
      expected.minute,
      expected.second,
    );
    timestamp += expectedAsUtc - actualAsUtc;
  }

  const resolved = new Date(timestamp);
  const actual = readZonedParts(resolved, timezone);
  if (!sameZonedParts(actual, expected)) {
    throw validationError(
      'scheduledLocalAt',
      'Local schedule time is invalid in the selected timezone.',
    );
  }

  for (let offsetMinutes = -180; offsetMinutes <= 180; offsetMinutes += 15) {
    if (offsetMinutes === 0) continue;

    const alternative = new Date(resolved.getTime() + offsetMinutes * 60_000);
    if (sameZonedParts(readZonedParts(alternative, timezone), expected)) {
      throw validationError(
        'scheduledLocalAt',
        'Local schedule time is ambiguous in the selected timezone.',
      );
    }
  }

  return resolved;
}

export function formatLocalDateTime(value: Date, timezoneValue: string): string {
  const timezone = normalizeTimezone(timezoneValue);
  const parts = readZonedParts(value, timezone);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(
    parts.minute,
  )}:${pad(parts.second)}`;
}

function sameZonedParts(
  left: Readonly<{
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  }>,
  right: Readonly<{
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  }>,
): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function readZonedParts(
  value: Date,
  timezone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}
