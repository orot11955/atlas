import assert from 'node:assert/strict';
import { test } from 'node:test';
import { presentPublicationSchedule } from './features/eventing/publication-schedule-presentation';

type Input = Parameters<typeof presentPublicationSchedule>[0];
const pending: Input = {
  action: 'publish',
  status: 'pending',
  target: { kind: 'revision', revisionId: 'revision-one', revisionNumber: 1 },
  operations: { canCancel: true, canRetry: false },
};

test('schedule presentation labels the captured Revision, not a newer editor pointer', () => {
  const view = presentPublicationSchedule(pending);
  assert.equal(view.targetId, 'revision-one');
  assert.match(view.targetLabel, /#1/u);
  assert.equal(view.needsReview, false);
  assert.equal(view.canCancel, true);
  assert.equal(view.canRetry, false);
});

test('withdraw target is a Publication identity and explains already-inactive handling', () => {
  const view = presentPublicationSchedule({
    ...pending,
    action: 'withdraw',
    target: { kind: 'publication', publicationId: 'publication-one' },
  });
  assert.equal(view.targetId, 'publication-one');
  assert.match(view.guidance, /새 공개본/u);
});

for (const status of ['pending', 'processing', 'completed', 'failed', 'cancelled'] as const) {
  test(`unresolved ${status} cannot expose a retry button even with an incorrect eligibility hint`, () => {
    const view = presentPublicationSchedule({
      ...pending,
      status,
      target: { kind: 'unresolved', reason: 'missing-target' },
      operations: { canCancel: true, canRetry: true },
    });
    assert.equal(view.canRetry, false);
    assert.equal(view.canCancel, status === 'pending');
    assert.equal(view.targetId, null);
    assert.equal(view.needsReview, true);
    if (status === 'failed') assert.match(view.guidance, /기존 이력은 보존/u);
  });
}

test('only failed resolved schedules with explicit eligibility can retry', () => {
  assert.equal(presentPublicationSchedule({ ...pending, status: 'failed' }).canRetry, false);
  assert.equal(presentPublicationSchedule({
    ...pending,
    status: 'failed',
    operations: { canCancel: false, canRetry: true },
  }).canRetry, true);
  assert.equal(presentPublicationSchedule({
    ...pending,
    status: 'completed',
    operations: { canCancel: true, canRetry: true },
  }).canRetry, false);
});

test('an older response without the contract fails closed rather than guessing eligibility', () => {
  const older = { action: 'publish', status: 'failed' } as Input;
  const view = presentPublicationSchedule(older);
  assert.equal(view.canRetry, false);
  assert.equal(view.canCancel, false);
  assert.equal(view.needsReview, true);
});

test('a contradictory action and target cannot enable retry', () => {
  const view = presentPublicationSchedule({
    ...pending,
    action: 'withdraw',
    status: 'failed',
    operations: { canCancel: false, canRetry: true },
  });
  assert.equal(view.canRetry, false);
  assert.equal(view.needsReview, true);
});
