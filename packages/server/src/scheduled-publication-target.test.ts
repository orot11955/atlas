import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ActorType, FixedClock, ScheduledPublicationCommandService,
  capturePublicationScheduleTarget, readPublicationScheduleTarget, createUuidV7, requestContext,
  type TargetedPublicationScheduleRecord, type PublicationScheduleEffectReceipt,
} from './index';

const id = (n: number) => createUuidV7(n);
const now = new Date('2030-01-01T00:00:00Z');
const site = { workspaceId: id(1), siteId: id(2), siteStatus: 'active', siteTimezone: 'UTC',
  contentId: id(3), contentStatus: 'ready', contentSiteId: id(4),
  readyRevisionId: id(5), readyRevisionNumber: 3, activePublicationId: id(6) };

test('publish capture freezes only the selected READY Revision', () => {
  const result = capturePublicationScheduleTarget(site, 'publish');
  assert.deepEqual(result, { action: 'publish', revisionId: site.readyRevisionId, revisionNumber: 3 });
  assert.equal(Object.isFrozen(result), true);
});

test('withdraw capture freezes only the selected active Publication', () => {
  assert.deepEqual(capturePublicationScheduleTarget(site, 'withdraw'), {
    action: 'withdraw', targetPublicationId: site.activePublicationId,
  });
});

test('incomplete, mixed, wrong-format and legacy targets cannot fall back to live pointers', () => {
  for (const record of [
    { action: 'publish' },
    { action: 'withdraw' },
    { action: 'publish', revisionId: site.readyRevisionId },
    { action: 'publish', revisionId: site.readyRevisionId, revisionNumber: 0 },
    { action: 'publish', revisionId: 'invalid', revisionNumber: 3 },
    { action: 'publish', revisionId: site.readyRevisionId, revisionNumber: 3, targetPublicationId: site.activePublicationId },
    { action: 'withdraw', targetPublicationId: site.activePublicationId, revisionNumber: 3 },
  ]) assert.throws(() => readPublicationScheduleTarget(record as never), /pinned target/u);
});

function fixture() {
  const schedule: TargetedPublicationScheduleRecord = {
    id: id(10), workspaceId: site.workspaceId, siteId: site.siteId, contentId: site.contentId,
    contentSiteId: site.contentSiteId, revisionId: site.readyRevisionId, revisionNumber: 3,
    action: 'publish', scheduledFor: now, timezone: 'UTC', scheduledLocalAt: '2030-01-01T00:00:00',
    status: 'processing', attemptCount: 2, nextAttemptAt: now, version: 7,
    requestedByAdminAccountId: id(11), createdAt: now, updatedAt: now,
  };
  const owner = { scheduleId: schedule.id, workspaceId: schedule.workspaceId, attemptNumber: 2, version: 7 };
  const tx = Symbol('effect transaction');
  let receipt: PublicationScheduleEffectReceipt | undefined;
  let commands = 0;
  const command = new ScheduledPublicationCommandService<symbol>(
    { run: (work) => work(tx) },
    { findPublicationScheduleForUpdate: async () => schedule } as never,
    {
      find: async (_id, _workspace, transaction) => { assert.equal(transaction, tx); return receipt; },
      insert: async (value, transaction) => { assert.equal(transaction, tx); receipt = value; },
    },
    { findContentSiteForUpdate: async () => ({ siteId: site.siteId }) } as never,
    (transaction) => {
      assert.equal(transaction, tx);
      return {
        publishRevision: async (_workspace: string, _content: string, _site: string, revisionId: string) => {
          commands += 1;
          assert.equal(revisionId, site.readyRevisionId);
          return { replayed: false, publication: { id: site.activePublicationId, revisionId, revisionNumber: 3 } };
        },
      } as never;
    },
    new FixedClock(now),
  );
  const run = (value = owner, actorId = schedule.requestedByAdminAccountId) => requestContext.run({
    requestId: id(20), traceId: id(21), actorType: ActorType.ADMIN, actorId,
    workspaceId: schedule.workspaceId, siteId: schedule.siteId,
  }, () => command.executeScheduled(value));
  return { schedule, owner, run, commands: () => commands, receipt: () => receipt };
}

test('a committed receipt prevents the same business command after repeated execution', async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { replayed: false, stale: false });
  assert.deepEqual(await f.run(), { replayed: true, stale: false });
  assert.equal(f.commands(), 1);
  assert.equal(f.receipt()?.publicationId, site.activePublicationId);
});

test('receipt replay survives lifecycle recovery with a new owner', async () => {
  const f = fixture();
  await f.run();
  f.schedule.attemptCount = 3;
  f.schedule.version = 10;
  assert.deepEqual(await f.run({ ...f.owner, attemptNumber: 3, version: 10 }), { replayed: true, stale: false });
  assert.equal(f.commands(), 1);
});

test('an obsolete owner cannot reach effects even if a receipt exists', async () => {
  const f = fixture();
  await f.run();
  f.schedule.version += 1;
  assert.deepEqual(await f.run(), { replayed: false, stale: true });
  assert.equal(f.commands(), 1);
});

test('a contradictory receipt fails instead of silently replaying a different target', async () => {
  const f = fixture();
  await f.run();
  f.schedule.revisionNumber = 4;
  await assert.rejects(f.run(), /immutable definition/u);
  assert.equal(f.commands(), 1);
});

test('wrong requester context cannot execute a correctly claimed schedule', async () => {
  const f = fixture();
  await assert.rejects(f.run(f.owner, id(99)), /scoped requester/u);
  assert.equal(f.commands(), 0);
});

test('legacy schedule targets are rejected before Publication effects', async () => {
  const f = fixture();
  delete f.schedule.revisionId;
  delete f.schedule.revisionNumber;
  await assert.rejects(f.run(), /pinned target/u);
  assert.equal(f.commands(), 0);
});

test('invalid ownership cannot turn an undefined TypeORM condition into an unscoped query', async () => {
  const f = fixture();
  await assert.rejects(f.run({ ...f.owner, workspaceId: '' }), /attempt owner/u);
  await assert.rejects(f.run({ ...f.owner, attemptNumber: NaN }), /attempt owner/u);
  assert.equal(f.commands(), 0);
});
