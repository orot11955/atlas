import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUuidV7 } from './core';
import { toPublicationScheduleView } from './modules/eventing/application/publication-schedule-view';
import type { TargetedPublicationScheduleRecord } from './modules/eventing/domain/scheduled-publication';

function fixture(
  patch: Partial<TargetedPublicationScheduleRecord> = {},
): TargetedPublicationScheduleRecord {
  const at = new Date('2030-01-01T00:00:00.000Z');
  return {
    id: createUuidV7(),
    workspaceId: createUuidV7(),
    siteId: createUuidV7(),
    contentId: createUuidV7(),
    contentSiteId: createUuidV7(),
    action: 'publish',
    revisionId: createUuidV7(),
    revisionNumber: 1,
    status: 'pending',
    scheduledFor: at,
    scheduledLocalAt: '2030-01-01T09:00:00',
    timezone: 'Asia/Seoul',
    nextAttemptAt: at,
    attemptCount: 0,
    version: 1,
    requestedByAdminAccountId: createUuidV7(),
    createdAt: at,
    updatedAt: at,
    ...patch,
  };
}

test('schedule view exposes only the pinned Revision and explicit nullable target fields', () => {
  const record = fixture();
  const before = structuredClone(record);
  const view = toPublicationScheduleView(record);
  assert.deepEqual(view.target, {
    kind: 'revision',
    revisionId: record.revisionId,
    revisionNumber: 1,
  });
  assert.equal(view.targetPublicationId, null);
  assert.equal(view.completedAt, null);
  assert.equal(view.scheduledFor, '2030-01-01T00:00:00.000Z');
  assert.equal(view.timezone, 'Asia/Seoul');
  assert.deepEqual(view.operations, { canCancel: true, canRetry: false });
  assert.deepEqual(record, before);
  assert.ok(Object.isFrozen(view));
  assert.ok(Object.isFrozen(view.target));
  assert.ok(Object.isFrozen(view.operations));
});

test('withdraw view uses the exact stored Publication and never a current active pointer', () => {
  const id = createUuidV7();
  const view = toPublicationScheduleView(fixture({
    action: 'withdraw',
    revisionId: undefined,
    revisionNumber: undefined,
    targetPublicationId: id,
    status: 'failed',
  }));
  assert.deepEqual(view.target, { kind: 'publication', publicationId: id });
  assert.equal(view.revisionId, null);
  assert.equal(view.revisionNumber, null);
  assert.equal(view.operations.canRetry, true);
});

for (const action of ['publish', 'withdraw'] as const) {
  for (const status of ['pending', 'failed', 'completed', 'cancelled', 'processing'] as const) {
    test(`targetless ${action}/${status} remains readable without enabling replay`, () => {
      const record = fixture({ action, status, revisionId: undefined, revisionNumber: undefined });
      const before = structuredClone(record);
      const view = toPublicationScheduleView(record);
      assert.deepEqual(view.target, { kind: 'unresolved', reason: 'missing-target' });
      assert.deepEqual(view.operations, { canCancel: status === 'pending', canRetry: false });
      assert.deepEqual(record, before);
    });
  }
}

for (const patch of [
  { revisionNumber: undefined },
  { revisionNumber: 0 },
  { revisionId: 'invalid' },
  { targetPublicationId: createUuidV7() },
  { action: 'withdraw' as const },
]) {
  test(`invalid pinned target is visible as unresolved: ${JSON.stringify(patch)}`, () => {
    const view = toPublicationScheduleView(fixture({ ...patch, status: 'failed' }));
    assert.deepEqual(view.target, { kind: 'unresolved', reason: 'invalid-target' });
    assert.equal(view.operations.canRetry, false);
    assert.equal(view.revisionId, null);
    assert.equal(view.targetPublicationId, null);
  });
}

for (const status of ['pending', 'processing', 'completed', 'failed', 'cancelled'] as const) {
  test(`resolved target eligibility is gated by lifecycle: ${status}`, () => {
    const view = toPublicationScheduleView(fixture({ status }));
    assert.deepEqual(view.operations, {
      canCancel: status === 'pending',
      canRetry: status === 'failed',
    });
  });
}

test('allow-listed schedule response omits future internal properties and raw errors', () => {
  const record = {
    ...fixture({ lastError: 'postgres://credential-marker@internal.example/db' }),
    internalToken: 'credential-marker',
  };
  const view = toPublicationScheduleView(record);
  assert.equal(view.failureCode, 'execution-failed');
  assert.equal(view.lastError, 'Publication schedule execution failed.');
  assert.equal(Object.hasOwn(view, 'internalToken'), false);
  assert.doesNotMatch(JSON.stringify(view), /credential-marker|internal\.example/u);
});
