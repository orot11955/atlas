import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DraftOperationCancelled,
  DraftSaveCoordinator,
  type DraftSaveInput,
  type DraftSavePorts,
} from '../draft-save-coordinator';
import type { Content } from '../content-types';

function content(version = 1, title = 'initial'): Content {
  return {
    id: 'content-1',
    workspaceId: 'workspace-1',
    type: 'post',
    status: 'draft',
    version: 1,
    currentRevisionNumber: null,
    readyRevisionNumber: null,
    archivedAt: null,
    createdByAdminAccountId: 'admin-1',
    createdAt: '2026-09-05T00:00:00Z',
    updatedAt: '2026-09-05T00:00:00Z',
    draft: {
      title,
      summary: null,
      bodyMarkdown: 'body',
      cover: null,
      draftVersion: version,
      updatedByAdminAccountId: 'admin-1',
      updatedAt: '2026-09-05T00:00:00Z',
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function fixture(overrides: Partial<DraftSavePorts> = {}) {
  const calls: DraftSaveInput[] = [];
  const ports: DraftSavePorts = {
    load: async () => content(),
    save: async (input) => {
      calls.push(input);
      return content(input.draftVersion + 1, input.title);
    },
    revision: async () => content(),
    restore: async () => content(3, 'restored'),
    archive: async () => ({ ...content(), status: 'archived' }),
    ...overrides,
  };
  const coordinator = new DraftSaveCoordinator(ports);
  await coordinator.reload();
  return { coordinator, calls };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('A save response preserves B edits and advances the acknowledged server version', async () => {
  const saved = deferred<Content>();
  const { coordinator } = await fixture({ save: () => saved.promise });
  coordinator.edit({ title: 'A' });
  const saving = coordinator.save();
  await tick();
  coordinator.edit({ title: 'B' });
  saved.resolve(content(2, 'A'));
  await saving;
  assert.equal(coordinator.getSnapshot().draft.title, 'B');
  assert.equal(coordinator.getSnapshot().content?.draft.draftVersion, 2);
  assert.equal(coordinator.getSnapshot().dirty, true);
});

test('manual and automatic saves serialize and the trailing save uses the new version', async () => {
  const first = deferred<Content>();
  const calls: DraftSaveInput[] = [];
  const { coordinator } = await fixture({
    save: async (input) => {
      calls.push(input);
      return calls.length === 1 ? first.promise : content(3, input.title);
    },
  });
  coordinator.edit({ title: 'A' });
  const automatic = coordinator.save();
  await tick();
  coordinator.edit({ title: 'B' });
  const manual = coordinator.save();
  await tick();
  assert.equal(calls.length, 1);
  first.resolve(content(2, 'A'));
  await Promise.all([automatic, manual]);
  assert.deepEqual(
    calls.map((call) => [call.title, call.draftVersion]),
    [
      ['A', 1],
      ['B', 2],
    ],
  );
  assert.equal(coordinator.getSnapshot().dirty, false);
});

test('duplicate clean saves do not send another PATCH', async () => {
  const { coordinator, calls } = await fixture();
  coordinator.edit({ title: 'A' });
  await Promise.all([coordinator.save(), coordinator.save(), coordinator.save()]);
  assert.equal(calls.length, 1);
});

for (const kind of ['checkpoint', 'ready'] as const) {
  test(`${kind} waits for autosave, flushes newer edits, and reserves editing`, async () => {
    const first = deferred<Content>();
    const calls: unknown[] = [];
    const { coordinator } = await fixture({
      save: async (input) => {
        calls.push(['save', input.title, input.draftVersion]);
        return calls.length === 1 ? first.promise : content(3, input.title);
      },
      revision: async (actualKind, input) => {
        calls.push([actualKind, input.draftVersion]);
        return { ...content(3, 'B'), version: 2, readyRevisionNumber: 1 };
      },
    });
    coordinator.edit({ title: 'A' });
    const saving = coordinator.save();
    await tick();
    coordinator.edit({ title: 'B' });
    const revision = coordinator.createRevision(kind);
    assert.equal(coordinator.getSnapshot().locked, true);
    assert.equal(coordinator.edit({ title: 'must not be accepted' }), false);
    first.resolve(content(2, 'A'));
    await Promise.all([saving, revision]);
    assert.deepEqual(calls, [
      ['save', 'A', 1],
      ['save', 'B', 2],
      [kind, 3],
    ]);
    assert.equal(coordinator.getSnapshot().draft.title, 'B');
    assert.equal(coordinator.getSnapshot().locked, false);
  });
}

test('409 preserves input and prevents queued saves and READY until explicit reload', async () => {
  const conflict = Object.assign(new Error('conflict'), { status: 409 });
  const failed = deferred<Content>();
  let saves = 0;
  let revisions = 0;
  const { coordinator } = await fixture({
    save: () => {
      saves += 1;
      return failed.promise;
    },
    revision: async () => {
      revisions += 1;
      return content();
    },
  });
  coordinator.edit({ title: 'A' });
  const one = coordinator.save();
  await tick();
  coordinator.edit({ title: 'B', summary: 'preserve me' });
  const two = coordinator.save();
  const ready = coordinator.createRevision('ready');
  const outcomes = Promise.allSettled([one, two, ready]);
  failed.reject(conflict);
  assert.ok((await outcomes).every((outcome) => outcome.status === 'rejected'));
  assert.equal(saves, 1);
  assert.equal(revisions, 0);
  assert.equal(coordinator.getSnapshot().draft.title, 'B');
  assert.equal(coordinator.getSnapshot().draft.summary, 'preserve me');
  assert.equal(coordinator.getSnapshot().dirty, true);
  assert.equal(coordinator.getSnapshot().error, conflict);
  assert.equal(coordinator.getSnapshot().locked, false);
  await coordinator.reload();
  assert.equal(coordinator.getSnapshot().error, undefined);
  assert.equal(coordinator.getSnapshot().dirty, false);
});

test('an ambiguous network failure pauses automatic retries without discarding text', async () => {
  const { coordinator } = await fixture({
    save: async () => {
      throw new Error('network');
    },
  });
  coordinator.edit({ bodyMarkdown: 'unsaved body' });
  await assert.rejects(coordinator.save(), /network/u);
  await assert.rejects(coordinator.save(), /network/u);
  assert.equal(coordinator.getSnapshot().draft.bodyMarkdown, 'unsaved body');
});

test('restore runs after an in-flight save and uses its acknowledged draft version', async () => {
  const first = deferred<Content>();
  const versions: number[] = [];
  const { coordinator } = await fixture({
    save: () => first.promise,
    restore: async (_id, version) => {
      versions.push(version);
      return content(3, 'restored');
    },
  });
  coordinator.edit({ title: 'A' });
  const saving = coordinator.save();
  await tick();
  const restoring = coordinator.restore('revision-1');
  first.resolve(content(2, 'A'));
  await Promise.all([saving, restoring]);
  assert.deepEqual(versions, [2]);
  assert.equal(coordinator.getSnapshot().draft.title, 'restored');
  assert.equal(coordinator.getSnapshot().dirty, false);
});

test('archive flushes the local draft first and prevents further edits', async () => {
  const calls: string[] = [];
  const { coordinator } = await fixture({
    save: async (input) => {
      calls.push(input.title);
      return { ...content(2, input.title), version: 4 };
    },
    archive: async (version) => {
      assert.equal(version, 4);
      calls.push('archive');
      return { ...content(2, 'A'), status: 'archived', version: 5 };
    },
  });
  coordinator.edit({ title: 'A' });
  await coordinator.archive();
  assert.deepEqual(calls, ['A', 'archive']);
  assert.equal(coordinator.edit({ title: 'B' }), false);
});

test('late responses and queued commands are cancelled after the editor unmounts', async () => {
  const first = deferred<Content>();
  let revisions = 0;
  const { coordinator } = await fixture({
    save: () => first.promise,
    revision: async () => {
      revisions += 1;
      return content();
    },
  });
  coordinator.edit({ title: 'A' });
  const saving = coordinator.save();
  await tick();
  const revision = coordinator.createRevision('ready');
  const results = Promise.allSettled([saving, revision]);
  coordinator.deactivate();
  first.resolve(content(2, 'A'));
  for (const result of await results) {
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') assert.ok(result.reason instanceof DraftOperationCancelled);
  }
  assert.equal(revisions, 0);
  assert.equal(coordinator.getSnapshot().content?.draft.draftVersion, 1);
});

test('Strict Mode activation can reload without accepting the old lifecycle response', async () => {
  const first = deferred<Content>();
  let loads = 0;
  const coordinator = new DraftSaveCoordinator({
    load: () => (++loads === 1 ? first.promise : Promise.resolve(content(5, 'new session'))),
  } as DraftSavePorts);
  const old = coordinator.reload();
  const rejected = assert.rejects(old, DraftOperationCancelled);
  await tick();
  coordinator.deactivate();
  coordinator.activate();
  const next = coordinator.reload();
  first.resolve(content(1, 'old session'));
  await Promise.all([rejected, next]);
  assert.equal(coordinator.getSnapshot().draft.title, 'new session');
  assert.equal(coordinator.getSnapshot().locked, false);
});

test('snapshots are stable between changes and cover data is defensively copied', async () => {
  const { coordinator } = await fixture();
  const previous = coordinator.getSnapshot();
  assert.equal(previous, coordinator.getSnapshot());
  let notifications = 0;
  const unsubscribe = coordinator.subscribe(() => {
    notifications += 1;
  });
  const cover = { assetId: 'asset-1', altText: 'before' };
  coordinator.edit({ cover });
  cover.altText = 'mutated';
  assert.equal(coordinator.getSnapshot().draft.cover?.altText, 'before');
  assert.notEqual(previous, coordinator.getSnapshot());
  assert.equal(notifications, 1);
  unsubscribe();
  coordinator.edit({ title: 'after unsubscribe' });
  assert.equal(notifications, 1);
});

test('concurrent READY intents do not create duplicate immutable revisions', async () => {
  const completed = deferred<Content>();
  let revisions = 0;
  const { coordinator } = await fixture({
    revision: async () => {
      revisions += 1;
      return completed.promise;
    },
  });
  const one = coordinator.createRevision('ready');
  const two = coordinator.createRevision('ready');
  const outcomes = Promise.allSettled([one, two]);
  await tick();
  completed.resolve({ ...content(), version: 2, readyRevisionNumber: 1 });
  const results = await outcomes;
  assert.equal(revisions, 1);
  assert.equal(results[1]?.status, 'rejected');
  assert.equal(coordinator.getSnapshot().error, undefined);
  assert.equal(coordinator.getSnapshot().locked, false);
});

test('a confirmed validation rejection can resume after editing without discarding input', async () => {
  const validation = Object.assign(new Error('invalid title'), { status: 400 });
  let saves = 0;
  const { coordinator } = await fixture({
    isValidationError: (error) => error === validation,
    save: async (input) => {
      saves += 1;
      if (saves === 1) throw validation;
      return content(input.draftVersion + 1, input.title);
    },
  });
  coordinator.edit({ title: 'bad', bodyMarkdown: 'preserved body' });
  await assert.rejects(coordinator.save(), /invalid title/u);
  assert.equal(coordinator.getSnapshot().needsReload, false);
  await assert.rejects(coordinator.save(), /invalid title/u);
  assert.equal(saves, 1, 'unchanged invalid input must not auto-retry');
  coordinator.edit({ title: 'corrected' });
  assert.equal(coordinator.getSnapshot().draft.bodyMarkdown, 'preserved body');
  assert.equal(coordinator.getSnapshot().error, undefined);
  await coordinator.save();
  assert.equal(saves, 2);
  assert.equal(coordinator.getSnapshot().content?.draft.draftVersion, 2);
});

test('validation failure cancels already queued intentions even after synchronous correction', async () => {
  const validation = new Error('invalid');
  const failing = deferred<Content>();
  let saves = 0;
  let revisions = 0;
  const { coordinator } = await fixture({
    isValidationError: (error) => error === validation,
    save: async (input) => {
      saves += 1;
      if (saves === 1) return failing.promise;
      return content(input.draftVersion + 1, input.title);
    },
    revision: async () => {
      revisions += 1;
      return content();
    },
  });
  coordinator.edit({ title: 'bad' });
  const first = coordinator.save();
  await tick();
  const queued = coordinator.createRevision('ready');
  const outcomes = Promise.allSettled([first, queued]);
  failing.reject(validation);
  await outcomes;
  coordinator.edit({ title: 'fixed' });
  await coordinator.save();
  assert.equal(saves, 2);
  assert.equal(revisions, 0);
});

test('editing never unblocks version conflicts or ambiguous errors', async () => {
  const conflict = Object.assign(new Error('conflict'), { status: 409 });
  const { coordinator } = await fixture({
    save: async () => {
      throw conflict;
    },
  });
  coordinator.edit({ title: 'A' });
  await assert.rejects(coordinator.save(), /conflict/u);
  coordinator.edit({ title: 'B' });
  assert.equal(coordinator.getSnapshot().needsReload, true);
  assert.equal(coordinator.getSnapshot().error, conflict);
  await assert.rejects(coordinator.save(), /conflict/u);
  assert.equal(coordinator.getSnapshot().draft.title, 'B');
});

test('unknown rejection values still block queued writes', async () => {
  let saves = 0;
  const { coordinator } = await fixture({
    save: async () => {
      saves += 1;
      return Promise.reject(undefined);
    },
  });
  coordinator.edit({ title: 'A' });
  await assert.rejects(coordinator.save(), /without an error/u);
  coordinator.edit({ title: 'B' });
  await assert.rejects(coordinator.save());
  assert.equal(saves, 1);
  assert.equal(coordinator.getSnapshot().needsReload, true);
});

test('a pre-failure queued save cannot revive when a listener immediately corrects validation', async () => {
  const validation = new Error('invalid');
  const failed = deferred<Content>();
  let saves = 0;
  const { coordinator } = await fixture({
    isValidationError: (error) => error === validation,
    save: async (input) => {
      saves += 1;
      return saves === 1 ? failed.promise : content(2, input.title);
    },
  });
  coordinator.edit({ title: 'invalid' });
  const first = coordinator.save();
  await tick();
  const oldIntent = coordinator.save();
  const results = Promise.allSettled([first, oldIntent]);
  let corrected = false;
  const unsubscribe = coordinator.subscribe(() => {
    if (!corrected && coordinator.getSnapshot().error === validation) {
      corrected = true;
      coordinator.edit({ title: 'corrected' });
    }
  });
  failed.reject(validation);
  assert.ok((await results).every((result) => result.status === 'rejected'));
  unsubscribe();
  assert.equal(saves, 1);
  assert.equal(coordinator.getSnapshot().error, undefined);
  await coordinator.save();
  assert.equal(saves, 2);
  assert.equal(coordinator.getSnapshot().draft.title, 'corrected');
});
