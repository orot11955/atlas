import { DomainError } from '../../../core/errors/application-error';
import { ErrorCode } from '../../../core/errors/error-code';
import { isUuidV7 } from '../../../core/ids/uuid-v7';
import type { EventType, OutboxEventRecord, WebhookEventType } from './eventing';

type Descriptor = Readonly<{
  schemaVersion: 1;
  aggregateType: string;
  handler: 'publication' | 'schedule' | 'webhook-retry';
  siteRequired: boolean;
}>;

// New EventType values must deliberately choose a versioned contract and handler.
// Never use object prototype lookup or a fallback handler for persisted event types.
export const EVENT_CONTRACT_REGISTRY = Object.freeze({
  'content.published': Object.freeze({
    schemaVersion: 1,
    aggregateType: 'content-publication',
    handler: 'publication',
    siteRequired: true,
  }),
  'content.unpublished': Object.freeze({
    schemaVersion: 1,
    aggregateType: 'content-publication',
    handler: 'publication',
    siteRequired: true,
  }),
  'publication.schedule.requested': Object.freeze({
    schemaVersion: 1,
    aggregateType: 'publication-schedule',
    handler: 'schedule',
    siteRequired: true,
  }),
  'publication.schedule.retry-requested': Object.freeze({
    schemaVersion: 1,
    aggregateType: 'publication-schedule',
    handler: 'schedule',
    siteRequired: true,
  }),
  'webhook.delivery.retry-requested': Object.freeze({
    schemaVersion: 1,
    aggregateType: 'webhook-delivery',
    handler: 'webhook-retry',
    siteRequired: false,
  }),
} satisfies Record<EventType, Descriptor>);

export type EventContractReason =
  | 'unsupported-event-type'
  | 'unsupported-schema-version'
  | 'invalid-envelope'
  | 'envelope-record-mismatch'
  | 'invalid-event-data'
  | 'invalid-aggregate';

/** Only trusted constants enter diagnostics. Never copy a rejected type, payload or value. */
export class EventContractError extends DomainError {
  public constructor(public readonly reason: EventContractReason) {
    super({
      code: ErrorCode.VALIDATION_FAILED,
      message: `Outbox Event contract rejected: ${reason}.`,
      details: { reason },
    });
  }
}

export type RegisteredEventRoute =
  | Readonly<{ kind: 'publication'; eventType: WebhookEventType; siteId: string }>
  | Readonly<{ kind: 'schedule'; scheduleId: string; attemptNumber: number; availableAt: Date }>
  | Readonly<{
      kind: 'webhook-retry';
      deliveryId: string;
      attemptNumber: number;
      availableAt: Date;
    }>;

/** Validate both persistence metadata and the immutable envelope before routing effects.
 * V1 permits bounded JSON extension fields, but extensions never control routing.
 * The original payload is neither rewritten nor repaired by this validator.
 */
export function resolveEventContract(event: Readonly<OutboxEventRecord>): RegisteredEventRoute {
  if (!event || !Object.hasOwn(EVENT_CONTRACT_REGISTRY, event.eventType)) {
    throw new EventContractError('unsupported-event-type');
  }
  const descriptor: Descriptor = EVENT_CONTRACT_REGISTRY[event.eventType as EventType];
  if (event.schemaVersion !== descriptor.schemaVersion) {
    throw new EventContractError('unsupported-schema-version');
  }
  const payload: unknown = event.payload;
  if (
    !isObject(payload) ||
    !isUuid(event.id) ||
    !isUuid(event.workspaceId) ||
    !isUuid(event.aggregateId) ||
    (event.siteId != null && !isUuid(event.siteId)) ||
    (descriptor.siteRequired && !isUuid(event.siteId)) ||
    !isTimestamp(payload.occurredAt)
  ) {
    throw new EventContractError('invalid-envelope');
  }
  if (
    payload.eventId !== event.id ||
    payload.workspaceId !== event.workspaceId ||
    payload.siteId !== (event.siteId ?? null) ||
    payload.aggregateId !== event.aggregateId ||
    payload.eventType !== event.eventType ||
    payload.schemaVersion !== event.schemaVersion
  ) {
    throw new EventContractError('envelope-record-mismatch');
  }
  if (event.aggregateType !== descriptor.aggregateType) {
    throw new EventContractError('invalid-aggregate');
  }
  const data = payload.data;
  if (!isObject(data)) throw new EventContractError('invalid-event-data');
  assertEventData(data);
  if (descriptor.handler === 'publication') {
    for (const key of ['publicationId', 'contentId', 'contentSiteId', 'revisionId']) {
      if (!isUuid(data[key])) throw new EventContractError('invalid-event-data');
    }
    if (data.publicationId !== event.aggregateId) throw new EventContractError('invalid-aggregate');
    if (
      !isPositiveInteger(data.revisionNumber) ||
      !isText(data.slug, 512) ||
      !isText(data.etag, 256)
    ) {
      throw new EventContractError('invalid-event-data');
    }
    if (
      event.eventType === 'content.published' &&
      (typeof data.visibility !== 'string' ||
        !['public', 'unlisted', 'private'].includes(data.visibility))
    ) {
      throw new EventContractError('invalid-event-data');
    }
    if (
      (data.replacedPublicationId != null && !isUuid(data.replacedPublicationId)) ||
      (data.sourcePublicationId !== undefined && !isUuid(data.sourcePublicationId)) ||
      (data.scheduled !== undefined && typeof data.scheduled !== 'boolean')
    ) {
      throw new EventContractError('invalid-event-data');
    }
    return Object.freeze({
      kind: 'publication',
      eventType: event.eventType as WebhookEventType,
      siteId: event.siteId!,
    });
  }
  const key = descriptor.handler === 'schedule' ? 'scheduleId' : 'deliveryId';
  const id = data[key];
  if (!isUuid(id) || !isPositiveInteger(data.attemptNumber) || !isTimestamp(data.availableAt)) {
    throw new EventContractError('invalid-event-data');
  }
  if (id !== event.aggregateId) throw new EventContractError('invalid-aggregate');
  const common = { attemptNumber: data.attemptNumber, availableAt: new Date(data.availableAt) };
  return descriptor.handler === 'schedule'
    ? Object.freeze({ kind: 'schedule', scheduleId: id, ...common })
    : Object.freeze({ kind: 'webhook-retry', deliveryId: id, ...common });
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && value === value.toLowerCase() && isUuidV7(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export function assertEventData(data: Record<string, unknown>): void {
  const seen = new Set<object>();
  let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 20_000 || depth > 32) throw new EventContractError('invalid-event-data');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if ((!isObject(value) && !Array.isArray(value)) || seen.has(value)) {
      throw new EventContractError('invalid-event-data');
    }
    seen.add(value);
    for (const child of Object.values(value)) visit(child, depth + 1);
    seen.delete(value);
  };
  visit(data, 0);
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 262_144) {
    throw new EventContractError('invalid-event-data');
  }
}
