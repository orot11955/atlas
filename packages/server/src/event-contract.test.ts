import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUuidV7 } from './core/ids/uuid-v7';
import {
  EVENT_CONTRACT_REGISTRY,
  EventContractError,
  resolveEventContract,
} from './modules/eventing/domain/event-contract';
import type { OutboxEventRecord } from './modules/eventing/domain/eventing';

function event(eventType = 'content.published'): OutboxEventRecord {
  const id = createUuidV7();
  const workspaceId = createUuidV7();
  const siteId = createUuidV7();
  const aggregateId = createUuidV7();
  const now = new Date('2030-01-01T00:00:00.000Z');
  const schedule = eventType.startsWith('publication.schedule.');
  const retry = eventType === 'webhook.delivery.retry-requested';
  return {
    id,
    workspaceId,
    siteId: retry ? undefined : siteId,
    aggregateId,
    aggregateType: schedule
      ? 'publication-schedule'
      : retry
        ? 'webhook-delivery'
        : 'content-publication',
    eventType,
    schemaVersion: 1,
    status: 'dispatched',
    availableAt: now,
    attemptCount: 1,
    createdAt: now,
    updatedAt: now,
    payload: {
      eventId: id,
      eventType,
      occurredAt: now.toISOString(),
      workspaceId,
      siteId: retry ? null : siteId,
      aggregateId,
      schemaVersion: 1,
      data:
        schedule || retry
          ? {
              [retry ? 'deliveryId' : 'scheduleId']: aggregateId,
              attemptNumber: 1,
              availableAt: now.toISOString(),
            }
          : {
              publicationId: aggregateId,
              contentId: createUuidV7(),
              contentSiteId: createUuidV7(),
              revisionId: createUuidV7(),
              revisionNumber: 1,
              slug: 'article',
              etag: 'e'.repeat(64),
              ...(eventType === 'content.published' ? { visibility: 'public' } : {}),
            },
    },
  };
}

for (const eventType of Object.keys(EVENT_CONTRACT_REGISTRY)) {
  test(`registered v1 ${eventType} routes without modifying its payload`, () => {
    const value = event(eventType);
    const before = structuredClone(value);
    const route = resolveEventContract(value);
    assert.equal(
      route.kind,
      EVENT_CONTRACT_REGISTRY[eventType as keyof typeof EVENT_CONTRACT_REGISTRY].handler,
    );
    assert.ok(Object.isFrozen(route));
    assert.deepEqual(value, before);
  });
}

test('registry has five frozen descriptors with no prototype fallback', () => {
  assert.equal(Object.keys(EVENT_CONTRACT_REGISTRY).length, 5);
  assert.ok(Object.isFrozen(EVENT_CONTRACT_REGISTRY));
  for (const descriptor of Object.values(EVENT_CONTRACT_REGISTRY))
    assert.ok(Object.isFrozen(descriptor));
});

const withData = (r: OutboxEventRecord, patch: Record<string, unknown>) => ({
  ...r,
  payload: { ...r.payload, data: { ...r.payload.data, ...patch } },
});
const mutations: ReadonlyArray<readonly [string, (r: OutboxEventRecord) => unknown]> = [
  ['unsupported type', (r) => ({ ...r, eventType: 'content.sensitive-marker' })],
  ['prototype type', (r) => ({ ...r, eventType: 'toString' })],
  ['future version', (r) => ({ ...r, schemaVersion: 2 })],
  ['numeric-string version', (r) => ({ ...r, schemaVersion: '1' })],
  ['missing envelope', (r) => ({ ...r, payload: null })],
  ['array envelope', (r) => ({ ...r, payload: [] })],
  ['missing site', (r) => ({ ...r, siteId: undefined, payload: { ...r.payload, siteId: null } })],
  ['upper-case identity', (r) => ({ ...r, id: '00000000-0000-7ABC-8ABC-000000000ABC' })],
  ['version mismatch', (r) => ({ ...r, payload: { ...r.payload, schemaVersion: 2 } })],
  ['event ID mismatch', (r) => ({ ...r, payload: { ...r.payload, eventId: createUuidV7() } })],
  ['type mismatch', (r) => ({ ...r, payload: { ...r.payload, eventType: 'content.unpublished' } })],
  ['workspace mismatch', (r) => ({ ...r, payload: { ...r.payload, workspaceId: createUuidV7() } })],
  ['site mismatch', (r) => ({ ...r, payload: { ...r.payload, siteId: createUuidV7() } })],
  ['aggregate mismatch', (r) => ({ ...r, payload: { ...r.payload, aggregateId: createUuidV7() } })],
  ['aggregate kind', (r) => ({ ...r, aggregateType: 'publication-schedule' })],
  [
    'bad date rollover',
    (r) => ({ ...r, payload: { ...r.payload, occurredAt: '2030-02-30T00:00:00.000Z' } }),
  ],
  ['missing publication target', (r) => withData(r, { publicationId: undefined })],
  ['different publication target', (r) => withData(r, { publicationId: createUuidV7() })],
  ['invalid content ID', (r) => withData(r, { contentId: 'sensitive-marker' })],
  ['fractional revision', (r) => withData(r, { revisionNumber: 1.5 })],
  ['coerced revision', (r) => withData(r, { revisionNumber: '1' })],
  ['invalid visibility', (r) => withData(r, { visibility: ['public'] })],
  ['invalid scheduled flag', (r) => withData(r, { scheduled: 'true' })],
  ['missing ETag', (r) => withData(r, { etag: '' })],
  ['array data', (r) => ({ ...r, payload: { ...r.payload, data: [] } })],
  ['nonfinite extension', (r) => withData(r, { extension: Number.NaN })],
  ['oversize extension', (r) => withData(r, { extension: 'x'.repeat(262_145) })],
  [
    'cyclic extension',
    (r) => {
      const x: Record<string, unknown> = {};
      x.self = x;
      return withData(r, { extension: x });
    },
  ],
  [
    'deep extension',
    (r) => {
      let x: unknown = 1;
      for (let i = 0; i < 33; i++) x = [x];
      return withData(r, { extension: x });
    },
  ],
];
for (const [name, mutate] of mutations) {
  test(`invalid event fails closed: ${name}`, () => {
    const value = mutate(event());
    assert.throws(
      () => resolveEventContract(value as OutboxEventRecord),
      (error: unknown) => {
        assert.ok(error instanceof EventContractError);
        assert.equal(error.code, 'VALIDATION_FAILED');
        assert.doesNotMatch(
          JSON.stringify({ message: error.message, details: error.details }),
          /sensitive-marker/,
        );
        return true;
      },
    );
  });
}
for (const name of ['publication.schedule.requested', 'webhook.delivery.retry-requested']) {
  test(`${name} rejects invalid queue arguments rather than coercing them`, () => {
    const r = event(name);
    for (const patch of [
      { attemptNumber: '1' },
      { attemptNumber: 0 },
      { availableAt: 'tomorrow' },
      { [name.startsWith('publication') ? 'scheduleId' : 'deliveryId']: createUuidV7() },
    ]) {
      assert.throws(() => resolveEventContract(withData(r, patch)), EventContractError);
    }
  });
}

test('valid bounded extension data and rollback metadata remain unchanged', () => {
  const r = withData(event(), {
    sourcePublicationId: createUuidV7(),
    replacedPublicationId: null,
    extension: { values: [1, { stable: true }] },
  });
  assert.equal(resolveEventContract(r).kind, 'publication');
  assert.deepEqual(r.payload.data.extension, { values: [1, { stable: true }] });
});
