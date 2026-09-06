import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Deliberately separate from DATABASE_URL and production configuration.
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.ATLAS_ALLOW_SCHEDULE_EFFECT_TESTS, '1');
const url = new URL(process.env.ATLAS_SCHEDULE_EFFECT_TEST_DATABASE_URL ?? '');
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.equal(url.pathname, '/atlas_schedule_effect_test');
assert.equal(url.search, '');
assert.equal(url.hash, '');
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(resolve(root, 'packages/database/package.json'));
const { DataSource, getMetadataArgsStorage } = require('typeorm');
const server = require('@atlas/server');
const {
  ActorType,
  AuditService,
  FixedClock,
  ContentPublicationService,
  OutboxService,
  PublicationSchedulingService,
  PublicationScheduleProcessor,
  ScheduledPublicationCommandService,
  TypeOrmContentPublicationRepository,
  TypeOrmContentAssetRepository,
  TypeOrmPublicationScheduleEffectRepository,
  TypeOrmEventingRepository,
  TypeOrmAuditRepository,
  createUuidV7,
  requestContext,
} = server;
const schema = `atlas_effect_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^atlas_effect_[0-9a-f]{32}$/u);
const ds = new DataSource({
  type: 'postgres',
  url: url.href,
  schema,
  entities: [...new Set(getMetadataArgsStorage().tables.map((table) => table.target))],
  synchronize: false,
  migrationsRun: false,
  logging: false,
  extra: { options: `-c search_path=${schema} -c lock_timeout=10000 -c statement_timeout=30000` },
});
await ds.initialize();
const control = ds.createQueryRunner();
const a = ds.createQueryRunner();
const b = ds.createQueryRunner();
await Promise.all([control.connect(), a.connect(), b.connect()]);
const [{ pid: pidA }] = await a.query('SELECT pg_backend_pid() AS pid');
const [{ pid: pidB }] = await b.query('SELECT pg_backend_pid() AS pid');
assert.notEqual(pidA, pidB);
let ownsSchema = false;
let passed = 0;
const now = new Date('2030-01-01T00:00:00Z');
const due = new Date('2030-01-01T00:01:00Z');
const later = new Date('2030-01-01T00:10:00Z');
const clock = new FixedClock(now);
const admin = createUuidV7(1);
const repository = new TypeOrmEventingRepository(ds);
const publications = new TypeOrmContentPublicationRepository(ds);
const assets = new TypeOrmContentAssetRepository(ds);
const effects = new TypeOrmPublicationScheduleEffectRepository();
const auditRepository = new TypeOrmAuditRepository(ds);
const audit = new AuditService(auditRepository, clock);
const outbox = new OutboxService(repository, clock);
const publicUrls = { buildPublicUrl: (key) => `https://media.example.test/${key}` };

async function transaction(connection, work) {
  await connection.startTransaction();
  try {
    const result = await work(connection.manager);
    await connection.commitTransaction();
    return result;
  } catch (error) {
    await connection.rollbackTransaction();
    throw error;
  }
}
const runner = (connection) => ({ run: (work) => transaction(connection, work) });
function inContext(c, work, actor = admin) {
  const id = createUuidV7();
  return requestContext.run(
    {
      requestId: id,
      traceId: id,
      actorType: ActorType.ADMIN,
      actorId: actor,
      workspaceId: c.workspace,
      siteId: c.site,
    },
    work,
  );
}
function publication(connection, auditService = audit, outboxService = outbox) {
  return new ContentPublicationService(
    runner(connection),
    publications,
    auditService,
    assets,
    publicUrls,
    clock,
    outboxService,
  );
}
function executor(connection, options = {}) {
  return new ScheduledPublicationCommandService(
    runner(connection),
    repository,
    options.effects ?? effects,
    publications,
    (tx) => {
      const service = new ContentPublicationService(
        { run: (work) => work(tx) },
        publications,
        options.audit ?? audit,
        assets,
        publicUrls,
        clock,
        options.outbox ?? outbox,
      );
      if (!options.beforePublish) return service;
      return {
        publishRevision: async (...args) => {
          await options.beforePublish();
          return service.publishRevision(...args);
        },
        withdraw: (...args) => service.withdraw(...args),
      };
    },
    clock,
  );
}
function processor(connection, command = executor(connection), at = due) {
  return new PublicationScheduleProcessor(
    runner(connection),
    repository,
    command,
    audit,
    new FixedClock(at),
  );
}
const scheduling = new PublicationSchedulingService(
  runner(control),
  repository,
  audit,
  outbox,
  clock,
);
const ownerOf = (s) => ({
  scheduleId: s.id,
  workspaceId: s.workspaceId,
  attemptNumber: s.attemptCount,
  version: s.version,
});
async function scenario(name, work) {
  await work();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}
function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
async function blocked(blockedPid, blockerPid) {
  for (let i = 0; i < 500; i += 1) {
    const [{ blockers }] = await control.query('SELECT pg_blocking_pids($1) AS blockers', [
      blockedPid,
    ]);
    if (blockers.includes(blockerPid)) return;
    await delay(10);
  }
  throw new Error('Expected PostgreSQL lock wait was not observed.');
}
async function rejectedSql(work, code = '23514') {
  await assert.rejects(transaction(control, work), (error) => {
    assert.equal(error.driverError?.code ?? error.code, code);
    return true;
  });
}
async function makeContext() {
  const c = {
    workspace: createUuidV7(),
    site: createUuidV7(),
    content: createUuidV7(),
    contentSite: createUuidV7(),
  };
  await transaction(control, async (tx) => {
    await tx.query(
      `INSERT INTO workspaces (id, key, name, timezone, locale, created_at, updated_at)
      VALUES ($1,$2,'Effect fixture','UTC','en',$3,$3)`,
      [c.workspace, `w-${c.workspace}`, now],
    );
    await tx.query(
      `INSERT INTO sites (id,workspace_id,key,name,type,status,timezone,locale,created_at,updated_at)
      VALUES ($1,$2,$3,'Fixture','blog','active','UTC','en',$4,$4)`,
      [c.site, c.workspace, `s-${c.site}`, now],
    );
    await tx.query(
      `INSERT INTO contents (id,workspace_id,type,status,created_by_admin_account_id,created_at,updated_at)
      VALUES ($1,$2,'post','draft',$3,$4,$4)`,
      [c.content, c.workspace, admin, now],
    );
    await tx.query(
      `INSERT INTO content_drafts (content_id,workspace_id,title,body_markdown,updated_by_admin_account_id,updated_at)
      VALUES ($1,$2,'Effect fixture','Body',$3,$4)`,
      [c.content, c.workspace, admin, now],
    );
    await tx.query(
      `INSERT INTO content_sites (id,workspace_id,content_id,site_id,slug,created_at,updated_at)
      VALUES ($1,$2,$3,$4,'effect-fixture',$5,$5)`,
      [c.contentSite, c.workspace, c.content, c.site, now],
    );
  });
  c.revision = await ready(c, 1);
  return c;
}
async function ready(c, number) {
  const revision = createUuidV7();
  await transaction(control, async (tx) => {
    await tx.query(
      `INSERT INTO content_revisions (id,content_id,workspace_id,revision_number,kind,title,
      body_markdown,body_html,source_draft_version,created_by_admin_account_id,created_at)
      VALUES ($1,$2,$3,$4,'ready',$5,$6,$7,1,$8,$9)`,
      [
        revision,
        c.content,
        c.workspace,
        number,
        `Revision ${number}`,
        `Body ${number}`,
        `<p>Body ${number}</p>`,
        admin,
        now,
      ],
    );
    await tx.query(
      `UPDATE contents SET status='ready', current_revision_number=$2, ready_revision_number=$2 WHERE id=$1`,
      [c.content, number],
    );
  });
  return revision;
}
async function schedule(c, action = 'publish') {
  return inContext(c, () =>
    scheduling.create(c.workspace, c.content, c.contentSite, {
      action,
      scheduledLocalAt: '2030-01-01T00:01:00',
      timezone: 'UTC',
    }),
  );
}
async function claim(connection, s, attempt = 1, at = due) {
  const row = await transaction(connection, (tx) =>
    repository.startPublicationScheduleAttempt(s.id, attempt, at, tx),
  );
  assert.ok(row);
  return ownerOf(row);
}
async function current(c) {
  return publications.findActivePublication(c.workspace, c.contentSite);
}
async function snapshot(c) {
  const state = {};
  for (const table of [
    'content_publications',
    'publication_schedule_effects',
    'outbox_events',
    'audit_logs',
  ]) {
    state[table] = await control.query(
      `SELECT * FROM ${table} WHERE workspace_id=$1 ORDER BY ${table === 'publication_schedule_effects' ? 'schedule_id' : 'id'}`,
      [c.workspace],
    );
  }
  return state;
}
async function legacySchedule(c) {
  const id = createUuidV7();
  await transaction(control, (tx) =>
    repository.insertPublicationSchedule(
      {
        id,
        workspaceId: c.workspace,
        siteId: c.site,
        contentId: c.content,
        contentSiteId: c.contentSite,
        action: 'publish',
        scheduledFor: due,
        timezone: 'UTC',
        scheduledLocalAt: '2030-01-01T00:01:00',
        requestedByAdminAccountId: admin,
        createdAt: now,
      },
      tx,
    ),
  );
  return { id };
}

try {
  await control.query(`CREATE SCHEMA "${schema}"`);
  ownsSchema = true;
  const directory = resolve(root, 'packages/database/dist/migrations');
  const files = readdirSync(directory)
    .filter((f) => /^\d+-.+\.js$/u.test(f))
    .sort();
  const last = '1788664800000-CreatePublicationScheduleEffects.js';
  assert.equal(files.at(-1), last);
  const migrations = files.map((file) => {
    const classes = Object.values(require(resolve(directory, file))).filter(
      (v) => typeof v === 'function' && typeof v.prototype.up === 'function',
    );
    assert.equal(classes.length, 1, file);
    return new classes[0]();
  });
  for (const migration of migrations.slice(0, -1))
    await transaction(control, () => migration.up(control));
  await control.query(
    `INSERT INTO admin_accounts (id,email,display_name,password_hash,role,password_changed_at,created_at,updated_at)
    VALUES ($1,'effect@atlas.test','Fixture','$argon2id$fixture-only','owner',$2,$2,$2)`,
    [admin, now],
  );
  const legacy = await makeContext();
  const legacyRow = await legacySchedule(legacy);
  const beforeLegacy = await control.query('SELECT * FROM publication_schedules WHERE id=$1', [
    legacyRow.id,
  ]);
  const migration = migrations.at(-1);
  await transaction(control, () => migration.up(control));
  console.log(`Applied ${migrations.length} actual migrations; worker sessions ${pidA}/${pidB}`);

  await scenario('migration preserves legacy intent and safe down/up before receipts', async () => {
    assert.deepEqual(
      await control.query('SELECT * FROM publication_schedules WHERE id=$1', [legacyRow.id]),
      beforeLegacy,
    );
    await transaction(control, () => migration.down(control));
    await transaction(control, () => migration.up(control));
    assert.deepEqual(
      await control.query('SELECT * FROM publication_schedules WHERE id=$1', [legacyRow.id]),
      beforeLegacy,
    );
  });
  await scenario('new unpinned schedule inserts are rejected', async () => {
    const c = await makeContext();
    await assert.rejects(legacySchedule(c), /pinned target/u);
  });
  await scenario('legacy execution fails without publishing or fabricating a target', async () => {
    await assert.rejects(processor(a).process(legacyRow.id, 1), /pinned target/u);
    const [row] = await control.query(
      'SELECT status,revision_id FROM publication_schedules WHERE id=$1',
      [legacyRow.id],
    );
    assert.equal(row.status, 'failed');
    assert.equal(row.revision_id, null);
    assert.equal((await snapshot(legacy)).publication_schedule_effects.length, 0);
    assert.equal(await current(legacy), undefined);
  });
  await scenario(
    'target capture re-reads READY after an actual ContentSite lock wait',
    async () => {
      const c = await makeContext();
      await a.startTransaction();
      await a.query('SELECT id FROM content_sites WHERE id=$1 FOR UPDATE', [c.contentSite]);
      const otherScheduler = new PublicationSchedulingService(
        runner(b),
        repository,
        audit,
        outbox,
        clock,
      );
      const pending = inContext(c, () =>
        otherScheduler.create(c.workspace, c.content, c.contentSite, {
          action: 'publish',
          scheduledLocalAt: '2030-01-01T00:01:00',
          timezone: 'UTC',
        }),
      );
      void pending.catch(() => undefined);
      let r2;
      try {
        await blocked(pidB, pidA);
        r2 = await ready(c, 2);
      } finally {
        await a.commitTransaction();
      }
      assert.equal((await pending).revisionId, r2);
    },
  );
  await scenario('publish pins R1 at creation and does not publish later READY R2', async () => {
    const c = await makeContext();
    const s = await schedule(c);
    assert.equal(s.revisionId, c.revision);
    assert.equal(s.revisionNumber, 1);
    const r2 = await ready(c, 2);
    await processor(a).process(s.id, 1);
    const active = await current(c);
    assert.equal(active.revisionId, c.revision);
    assert.notEqual(active.revisionId, r2);
    const state = await snapshot(c);
    assert.equal(state.publication_schedule_effects.length, 1);
    assert.equal(state.publication_schedule_effects[0].publication_id, active.id);
    assert.equal(
      state.outbox_events.filter((row) => row.event_type === 'content.published').length,
      1,
    );
    const listed = await scheduling.list(c.workspace, { contentId: c.content });
    assert.equal(listed[0].revisionId, c.revision);
  });
  await scenario('withdraw of superseded P1 leaves newer active P2 unchanged', async () => {
    const c = await makeContext();
    const p1 = await inContext(c, () =>
      publication(a).publishRevision(c.workspace, c.content, c.contentSite, c.revision),
    );
    const s = await schedule(c, 'withdraw');
    assert.equal(s.targetPublicationId, p1.publication.id);
    const r2 = await ready(c, 2);
    const p2 = await inContext(c, () =>
      publication(b).publishRevision(c.workspace, c.content, c.contentSite, r2),
    );
    await processor(a).process(s.id, 1);
    assert.equal((await current(c)).id, p2.publication.id);
    const state = await snapshot(c);
    assert.equal(state.publication_schedule_effects[0].outcome, 'already-inactive');
    assert.equal(
      state.outbox_events.filter((row) => row.event_type === 'content.unpublished').length,
      0,
    );
  });
  await scenario('withdraw of the pinned active target is applied once', async () => {
    const c = await makeContext();
    await inContext(c, () =>
      publication(a).publishRevision(c.workspace, c.content, c.contentSite, c.revision),
    );
    const s = await schedule(c, 'withdraw');
    await processor(a).process(s.id, 1);
    assert.equal(await current(c), undefined);
    const before = await snapshot(c);
    assert.equal(before.publication_schedule_effects[0].outcome, 'withdrawn');
    assert.equal(
      before.outbox_events.filter((row) => row.event_type === 'content.unpublished').length,
      1,
    );
    await processor(b).process(s.id, 1);
    assert.deepEqual(await snapshot(c), before);
  });
  await scenario(
    'a new owner replays the receipt after a post-commit interruption and later manual publication',
    async () => {
      const c = await makeContext();
      const s = await schedule(c);
      const owner = await claim(a, s);
      await inContext(c, () => executor(a).executeScheduled(owner)); // No bookkeeping completion: injected crash boundary.
      const r2 = await ready(c, 2);
      const p2 = await inContext(c, () =>
        publication(b).publishRevision(c.workspace, c.content, c.contentSite, r2),
      );
      const before = await snapshot(c);
      await transaction(b, (tx) =>
        repository.recoverStalePublicationSchedules(new Date(later.getTime() - 30000), later, tx),
      );
      await processor(b, executor(b), later).process(s.id, 2);
      assert.equal((await current(c)).id, p2.publication.id);
      const after = await snapshot(c);
      assert.deepEqual(after.content_publications, before.content_publications);
      assert.deepEqual(after.outbox_events, before.outbox_events);
      assert.deepEqual(after.publication_schedule_effects, before.publication_schedule_effects);
    },
  );
  for (const point of ['audit', 'outbox', 'receipt']) {
    await scenario(
      `${point} failure rolls back Publication, Audit, Outbox and effect together`,
      async () => {
        const c = await makeContext();
        const s = await schedule(c);
        const owner = await claim(a, s);
        const before = await snapshot(c);
        const options = {};
        if (point === 'audit')
          options.audit = new AuditService(
            {
              insert: async (record, tx) => {
                await auditRepository.insert(record, tx);
                throw new Error('injected audit');
              },
            },
            clock,
          );
        if (point === 'outbox')
          options.outbox = {
            record: async (input, tx) => {
              await outbox.record(input, tx);
              throw new Error('injected outbox');
            },
          };
        if (point === 'receipt')
          options.effects = {
            find: (...args) => effects.find(...args),
            insert: async (value, tx) => {
              await effects.insert(value, tx);
              throw new Error('injected receipt');
            },
          };
        await assert.rejects(
          inContext(c, () => executor(a, options).executeScheduled(owner)),
          /injected/u,
        );
        assert.deepEqual(await snapshot(c), before);
        await inContext(c, () => executor(a).executeScheduled(owner));
        assert.equal((await snapshot(c)).publication_schedule_effects.length, 1);
      },
    );
  }
  await scenario(
    'late owner is rejected before any business effect after stale recovery',
    async () => {
      const c = await makeContext();
      const s = await schedule(c);
      const old = await claim(a, s);
      await transaction(b, (tx) =>
        repository.recoverStalePublicationSchedules(new Date(later.getTime() - 30000), later, tx),
      );
      const next = await claim(b, s, 2, later);
      const before = await snapshot(c);
      assert.deepEqual(await inContext(c, () => executor(a).executeScheduled(old)), {
        replayed: false,
        stale: true,
      });
      assert.deepEqual(await snapshot(c), before);
      await inContext(c, () => executor(b).executeScheduled(next));
    },
  );
  await scenario(
    'concurrent same-owner commands block and converge on one durable effect',
    async () => {
      const c = await makeContext();
      const s = await schedule(c);
      const owner = await claim(a, s);
      const entered = deferred();
      const release = deferred();
      const first = inContext(c, () =>
        executor(a, {
          beforePublish: async () => {
            entered.resolve();
            await release.promise;
          },
        }).executeScheduled(owner),
      );
      await entered.promise;
      const second = inContext(c, () => executor(b).executeScheduled(owner));
      void second.catch(() => undefined);
      try {
        await blocked(pidB, pidA);
      } finally {
        release.resolve();
      }
      assert.equal((await first).replayed, false);
      assert.equal((await second).replayed, true);
      assert.equal((await snapshot(c)).content_publications.length, 1);
      assert.equal((await snapshot(c)).publication_schedule_effects.length, 1);
    },
  );
  await scenario(
    'recovery cannot steal ownership while the Publication transaction holds the schedule lock',
    async () => {
      const c = await makeContext();
      const s = await schedule(c);
      const owner = await claim(a, s);
      const entered = deferred();
      const release = deferred();
      const first = inContext(c, () =>
        executor(a, {
          beforePublish: async () => {
            entered.resolve();
            await release.promise;
          },
        }).executeScheduled(owner),
      );
      await entered.promise;
      const recovery = transaction(b, (tx) =>
        repository.recoverStalePublicationSchedules(new Date(later.getTime() - 30000), later, tx),
      );
      void recovery.catch(() => undefined);
      try {
        await blocked(pidB, pidA);
      } finally {
        release.resolve();
      }
      await first;
      await recovery;
      const before = await snapshot(c);
      await processor(b, executor(b), later).process(s.id, 2);
      assert.deepEqual((await snapshot(c)).content_publications, before.content_publications);
    },
  );
  await scenario('receipt records reject update/delete and destructive rollback', async () => {
    const rows = await control.query(
      'SELECT schedule_id FROM publication_schedule_effects LIMIT 1',
    );
    await rejectedSql((tx) =>
      tx.query('UPDATE publication_schedule_effects SET outcome=outcome WHERE schedule_id=$1', [
        rows[0].schedule_id,
      ]),
    );
    await rejectedSql((tx) =>
      tx.query('DELETE FROM publication_schedule_effects WHERE schedule_id=$1', [
        rows[0].schedule_id,
      ]),
    );
    await rejectedSql(() => migration.down(control));
    assert.ok(
      (await control.query('SELECT count(*)::int AS n FROM publication_schedule_effects'))[0].n > 0,
    );
  });
  await scenario('wrong requester and cross-workspace owners cannot publish', async () => {
    const c = await makeContext();
    const s = await schedule(c);
    const owner = await claim(a, s);
    const before = await snapshot(c);
    await assert.rejects(
      inContext(c, () => executor(a).executeScheduled(owner), createUuidV7()),
      /scoped requester/u,
    );
    assert.equal(
      (
        await inContext(c, () =>
          executor(a).executeScheduled({ ...owner, workspaceId: createUuidV7() }),
        )
      ).stale,
      true,
    );
    assert.deepEqual(await snapshot(c), before);
  });
  assert.equal(passed, 16);
  console.log(
    JSON.stringify({ result: 'success', scenarios: passed, migrations: migrations.length }),
  );
} finally {
  for (const connection of [a, b, control])
    if (connection.isTransactionActive) await connection.rollbackTransaction();
  await Promise.all([a.release(), b.release()]);
  if (ownsSchema) await control.query(`DROP SCHEMA "${schema}" CASCADE`);
  await control.release();
  await ds.destroy();
}
