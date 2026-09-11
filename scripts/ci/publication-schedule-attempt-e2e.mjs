import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// Only this explicitly named, loopback test database is accepted. Never use DATABASE_URL.
const url = new URL(process.env.ATLAS_ATTEMPT_TEST_DATABASE_URL ?? '');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.ATLAS_ALLOW_ATTEMPT_TESTS, '1');
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.equal(url.pathname, '/atlas_schedule_attempt_test');
assert.equal(url.search, '');
assert.equal(url.hash, '');
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(resolve(root, 'packages/database/package.json'));
const { DataSource } = require('typeorm');
const {
  AuditLogEntity,
  AuditService,
  DomainError,
  ErrorCode,
  FixedClock,
  PublicationScheduleEntity,
  PublicationScheduleProcessor,
  TypeOrmAuditRepository,
  TypeOrmEventingRepository,
} = require('@atlas/server');
const schema = `atlas_r04_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^atlas_r04_[0-9a-f]{32}$/u);
const ds = new DataSource({
  type: 'postgres',
  url: url.href,
  schema,
  entities: [PublicationScheduleEntity, AuditLogEntity],
  synchronize: false,
  migrationsRun: false,
  logging: false,
  extra: {
    max: 6,
    options: `-c search_path=${schema} -c lock_timeout=10000 -c statement_timeout=20000`,
  },
});
await ds.initialize();
const runner = ds.createQueryRunner();
const a = ds.createQueryRunner();
const b = ds.createQueryRunner();
await Promise.all([runner.connect(), a.connect(), b.connect()]);
const [{ pid: pidA }] = await a.query('SELECT pg_backend_pid() AS pid');
const [{ pid: pidB }] = await b.query('SELECT pg_backend_pid() AS pid');
assert.notEqual(pidA, pidB, 'workers must have separate PostgreSQL sessions');
const repository = new TypeOrmEventingRepository(ds);
const clock = new FixedClock('2030-01-01T00:00:00Z');
const admin = randomUUID();
const startedAt = clock.now();
const staleBefore = new Date(startedAt.getTime() + 1);
const recoveredAt = new Date(startedAt.getTime() + 600_000);
const auditRepository = new TypeOrmAuditRepository(ds);
const audit = new AuditService(auditRepository, clock);
let ownsSchema = false;
let passed = 0;

async function transaction(connection, operation) {
  assert.equal(connection.isTransactionActive, false, 'accidental nested worker transaction');
  await connection.startTransaction();
  try {
    const value = await operation(connection.manager);
    await connection.commitTransaction();
    return value;
  } catch (error) {
    if (connection.isTransactionActive) await connection.rollbackTransaction();
    throw error;
  }
}

function ownerOf(record) {
  assert.ok(record);
  return Object.freeze({
    scheduleId: record.id,
    workspaceId: record.workspaceId,
    attemptNumber: record.attemptCount,
    version: record.version,
  });
}

async function snapshot(id) {
  const [row] = await runner.query('SELECT * FROM publication_schedules WHERE id = $1', [id]);
  const logs = await runner.query('SELECT * FROM audit_logs WHERE target_id = $1 ORDER BY id', [
    id,
  ]);
  return { row, logs };
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Worker barrier timed out.')), 8_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function processor(connection, execute, auditService = audit, now = startedAt) {
  return new PublicationScheduleProcessor(
    { run: (work) => transaction(connection, work) },
    repository,
    {
      executeScheduled: async () => {
        await execute();
        return { replayed: false, stale: false };
      },
    },
    auditService,
    new FixedClock(now),
  );
}

async function waitForDatabaseBlock(blockedPid, blockingPid) {
  const until = Date.now() + 5_000;
  while (Date.now() < until) {
    const [{ blockers }] = await runner.query('SELECT pg_blocking_pids($1::int) AS blockers', [
      blockedPid,
    ]);
    if (blockers.includes(blockingPid)) return;
    await delay(10);
  }
  throw new Error('Expected PostgreSQL row-lock contention was not observed.');
}

async function scenario(name, operation) {
  await operation();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function makeContext(workspace = randomUUID()) {
  const site = randomUUID();
  const content = randomUUID();
  const contentSite = randomUUID();
  const revision = randomUUID();
  const publication = randomUUID();
  await runner.query(
    `INSERT INTO workspaces (id, key, name, timezone, locale, created_at, updated_at)
     VALUES ($1, $2, 'Schema fixture', 'UTC', 'en', now(), now()) ON CONFLICT (id) DO NOTHING`,
    [workspace, `ws-${workspace}`],
  );
  await runner.query(
    `INSERT INTO sites (id, workspace_id, key, name, type, status, timezone, locale, created_at, updated_at)
     VALUES ($1, $2, $3, 'Fixture', 'blog', 'active', 'UTC', 'en', now(), now())`,
    [site, workspace, `site-${site}`],
  );
  await runner.query(
    `INSERT INTO contents (id, workspace_id, type, status, created_by_admin_account_id, created_at, updated_at)
     VALUES ($1, $2, 'post', 'draft', $3, now(), now())`,
    [content, workspace, admin],
  );
  await runner.query(
    `INSERT INTO content_revisions (id, content_id, workspace_id, revision_number, kind, title,
       body_markdown, body_html, source_draft_version, created_by_admin_account_id, created_at)
     VALUES ($1, $2, $3, 1, 'ready', 'Fixture', 'body', '<p>body</p>', 1, $4, now())`,
    [revision, content, workspace, admin],
  );
  await runner.query(
    `INSERT INTO content_sites (id, workspace_id, content_id, site_id, slug, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'fixture', now(), now())`,
    [contentSite, workspace, content, site],
  );
  await runner.query(
    `INSERT INTO content_publications (id, workspace_id, content_site_id, content_id, content_type,
       site_id, site_key, site_name, revision_id, revision_number, status, slug, title,
       body_html, visibility, etag, published_at, created_by_admin_account_id, created_at)
     VALUES ($1, $2, $3, $4, 'post', $5, $6, 'Fixture', $7, 1, 'active', 'fixture',
       'Fixture', '<p>body</p>', 'public', $8, now(), $9, now())`,
    [
      publication,
      workspace,
      contentSite,
      content,
      site,
      `site-${site}`,
      revision,
      'a'.repeat(64),
      admin,
    ],
  );
  return { workspace, site, content, contentSite, revision, publication };
}

async function makeSchedule(action = 'publish') {
  const context = await transaction(runner, () => makeContext());
  const id = randomUUID();
  await transaction(runner, (manager) =>
    repository.insertPublicationSchedule(
      {
        id,
        workspaceId: context.workspace,
        siteId: context.site,
        contentId: context.content,
        contentSiteId: context.contentSite,
        action,
        revisionId: action === 'publish' ? context.revision : undefined,
        revisionNumber: action === 'publish' ? 1 : undefined,
        targetPublicationId: action === 'withdraw' ? context.publication : undefined,
        scheduledFor: startedAt,
        timezone: 'UTC',
        scheduledLocalAt: '2030-01-01T00:00:00',
        requestedByAdminAccountId: admin,
        createdAt: startedAt,
      },
      manager,
    ),
  );
  return { id, ...context };
}

async function claim(connection, id, attempt = 1, now = startedAt) {
  return transaction(connection, (manager) =>
    repository.startPublicationScheduleAttempt(id, attempt, now, manager),
  );
}

async function complete(connection, owner, now = recoveredAt) {
  return transaction(connection, (manager) =>
    repository.completePublicationSchedule(owner, now, manager),
  );
}

async function rejectLate(connection, owner, terminal = false) {
  return transaction(connection, (manager) =>
    repository.reschedulePublicationSchedule(
      owner,
      recoveredAt,
      'late attempt failure',
      terminal,
      recoveredAt,
      manager,
    ),
  );
}

async function recover(connection) {
  return transaction(connection, (manager) =>
    repository.recoverStalePublicationSchedules(staleBefore, recoveredAt, manager),
  );
}

try {
  await runner.query(`CREATE SCHEMA "${schema}"`);
  ownsSchema = true;
  const migrationDirectory = resolve(root, 'packages/database/dist/migrations');
  const files = readdirSync(migrationDirectory)
    .filter((file) => /^\d+-.+\.js$/u.test(file))
    .sort();
  assert.ok(files.includes('1788652800000-ExpandPublicationScheduleTargets.js'));
  await transaction(runner, async () => {
    for (const file of files) {
      const classes = Object.values(require(resolve(migrationDirectory, file))).filter(
        (value) => typeof value === 'function' && typeof value.prototype.up === 'function',
      );
      assert.equal(classes.length, 1, file);
      await new classes[0]().up(runner);
    }
    await runner.query(
      `INSERT INTO admin_accounts (id, email, display_name, password_hash, role,
         password_changed_at, created_at, updated_at)
       VALUES ($1, 'attempt-fixture@atlas.test', 'Attempt fixture', '$argon2id$fixture-only',
         'owner', now(), now(), now())`,
      [admin],
    );
  });
  console.log(
    `Applied ${files.length} real migrations; independent worker sessions ${pidA}/${pidB}`,
  );

  await scenario('claim, completion, failure and recovery reject autocommit usage', async () => {
    const s = await makeSchedule();
    const owner = { scheduleId: s.id, workspaceId: s.workspace, attemptNumber: 1, version: 2 };
    for (const call of [
      () => repository.startPublicationScheduleAttempt(s.id, 1, startedAt, ds.manager),
      () => repository.completePublicationSchedule(owner, startedAt, ds.manager),
      () =>
        repository.reschedulePublicationSchedule(
          owner,
          startedAt,
          'failure',
          false,
          startedAt,
          ds.manager,
        ),
      () => repository.recoverStalePublicationSchedules(staleBefore, recoveredAt, ds.manager),
    ]) {
      await assert.rejects(call, /active transaction/u);
    }
    assert.equal((await snapshot(s.id)).row.status, 'pending');
  });

  await scenario('future and stale job attempts do not claim a schedule', async () => {
    const s = await makeSchedule();
    const before = await snapshot(s.id);
    assert.equal(await claim(a, s.id, 1, new Date(startedAt.getTime() - 1)), undefined);
    assert.equal(await claim(a, s.id, 2), undefined);
    assert.deepEqual(await snapshot(s.id), before);
  });

  await scenario('two competing claims grant only one committed owner', async () => {
    const s = await makeSchedule();
    await a.startTransaction();
    const first = await repository.startPublicationScheduleAttempt(s.id, 1, startedAt, a.manager);
    assert.ok(first);
    const second = claim(b, s.id);
    void second.catch(() => undefined);
    await waitForDatabaseBlock(pidB, pidA);
    await a.commitTransaction();
    assert.equal(await bounded(second), undefined);
    assert.equal(await complete(a, ownerOf(first)), true);
  });

  await scenario('all owner fields are mandatory and independently checked', async () => {
    const s = await makeSchedule();
    const owner = ownerOf(await claim(a, s.id));
    const before = await snapshot(s.id);
    for (const wrong of [
      { workspaceId: randomUUID() },
      { scheduleId: randomUUID() },
      { attemptNumber: 2 },
      { version: 1 },
    ]) {
      assert.equal(await complete(b, { ...owner, ...wrong }), false);
      assert.equal(await rejectLate(b, { ...owner, ...wrong }, true), false);
      assert.deepEqual(await snapshot(s.id), before);
    }
    for (const invalid of [
      undefined,
      {},
      { ...owner, attemptNumber: 0 },
      { ...owner, version: NaN },
    ]) {
      await assert.rejects(
        () => complete(b, invalid),
        /complete Publication schedule attempt owner/u,
      );
    }
    assert.deepEqual(await snapshot(s.id), before);
    assert.equal(await complete(a, owner), true);
    const completed = await snapshot(s.id);
    assert.equal(await complete(b, owner), false);
    assert.equal(await rejectLate(b, owner), false);
    assert.deepEqual(await snapshot(s.id), completed);
  });

  await scenario('recovery invalidates the old owner before a new attempt starts', async () => {
    const s = await makeSchedule();
    const owner = ownerOf(await claim(a, s.id));
    assert.equal(await recover(b), 1);
    const pending = await snapshot(s.id);
    assert.equal(pending.row.version, owner.version + 1);
    assert.equal(pending.row.attempt_count, owner.attemptNumber);
    assert.equal(await complete(a, owner), false);
    assert.equal(await rejectLate(a, owner), false);
    assert.deepEqual(await snapshot(s.id), pending);
    assert.equal(await claim(a, s.id, 1, recoveredAt), undefined);
    const next = await claim(b, s.id, 2, recoveredAt);
    assert.equal(await complete(b, ownerOf(next)), true);
  });

  await scenario('late failures cannot resurrect a cancelled recovered schedule', async () => {
    const s = await makeSchedule();
    const owner = ownerOf(await claim(a, s.id));
    assert.equal(await recover(b), 1);
    const current = (await snapshot(s.id)).row;
    assert.equal(
      await transaction(b, (manager) =>
        repository.cancelPublicationSchedule(
          s.workspace,
          s.id,
          current.version,
          recoveredAt,
          manager,
        ),
      ),
      true,
    );
    const cancelled = await snapshot(s.id);
    assert.equal(await rejectLate(a, owner), false);
    assert.equal(await rejectLate(a, owner, true), false);
    assert.equal(await complete(a, owner), false);
    assert.deepEqual(await snapshot(s.id), cancelled);
  });

  await scenario(
    'manual retry keeps attempt numbers monotonic and invalidates old ownership',
    async () => {
      const s = await makeSchedule();
      const owner = ownerOf(await claim(a, s.id));
      assert.equal(await rejectLate(a, owner, true), true);
      const failed = (await snapshot(s.id)).row;
      assert.equal(
        await transaction(b, (manager) =>
          repository.retryPublicationSchedule(
            s.workspace,
            s.id,
            failed.version,
            recoveredAt,
            manager,
          ),
        ),
        true,
      );
      assert.equal((await snapshot(s.id)).row.attempt_count, 1);
      const next = await claim(b, s.id, 2, recoveredAt);
      assert.equal(await complete(b, ownerOf(next)), true);
      const completed = await snapshot(s.id);
      assert.equal(await rejectLate(a, owner, true), false);
      assert.deepEqual(await snapshot(s.id), completed);
    },
  );

  await scenario(
    'recovery waiting behind completion rechecks status and changes zero rows',
    async () => {
      const s = await makeSchedule();
      const owner = ownerOf(await claim(a, s.id));
      await a.startTransaction();
      assert.equal(
        await repository.completePublicationSchedule(owner, recoveredAt, a.manager),
        true,
      );
      const recovery = recover(b);
      void recovery.catch(() => undefined);
      await waitForDatabaseBlock(pidB, pidA);
      await a.commitTransaction();
      assert.equal(await bounded(recovery), 0);
      assert.equal((await snapshot(s.id)).row.status, 'completed');
    },
  );

  await scenario(
    'completion waiting behind recovery rechecks owner and changes zero rows',
    async () => {
      const s = await makeSchedule();
      const owner = ownerOf(await claim(a, s.id));
      await a.startTransaction();
      assert.equal(
        await repository.recoverStalePublicationSchedules(staleBefore, recoveredAt, a.manager),
        1,
      );
      const completion = complete(b, owner);
      void completion.catch(() => undefined);
      await waitForDatabaseBlock(pidB, pidA);
      await a.commitTransaction();
      assert.equal(await bounded(completion), false);
      const next = await claim(b, s.id, 2, recoveredAt);
      assert.equal(await complete(b, ownerOf(next)), true);
    },
  );

  for (const action of ['publish', 'withdraw']) {
    for (const outcome of ['success', 'retryable-failure', 'terminal-failure']) {
      await scenario(
        `late ${action} ${outcome} preserves the new owner's entire row and Audit`,
        async () => {
          const s = await makeSchedule(action);
          const entered = deferred();
          const release = deferred();
          const old = processor(a, async () => {
            assert.equal(a.isTransactionActive, false);
            entered.resolve();
            return release.promise;
          });
          // Observe rejection immediately so a delayed failing job cannot become unhandled.
          const oldResult = old.process(s.id, 1).then(
            () => ({ ok: true }),
            (error) => ({ error }),
          );
          await bounded(entered.promise);
          assert.equal(await recover(b), 1);
          await processor(
            b,
            async () => {
              assert.equal(b.isTransactionActive, false);
            },
            audit,
            recoveredAt,
          ).process(s.id, 2);
          const completed = await snapshot(s.id);
          assert.equal(completed.row.status, 'completed');
          assert.equal(completed.row.attempt_count, 2);
          assert.equal(completed.logs.length, 1);
          assert.equal(completed.logs[0].metadata.attemptNumber, 2);
          if (outcome === 'success') release.resolve();
          else if (outcome === 'terminal-failure') {
            release.reject(
              new DomainError({ code: ErrorCode.NOT_FOUND, message: 'old target gone' }),
            );
          } else release.reject(new Error('old transient failure'));
          const result = await bounded(oldResult);
          assert.equal(Boolean(result.ok), outcome === 'success');
          assert.deepEqual(await snapshot(s.id), completed);
        },
      );
    }
  }

  await scenario('late success cannot finish a newer attempt still executing', async () => {
    const s = await makeSchedule();
    const enteredA = deferred();
    const enteredB = deferred();
    const releaseA = deferred();
    const releaseB = deferred();
    const old = processor(a, async () => {
      enteredA.resolve();
      await releaseA.promise;
    }).process(s.id, 1);
    void old.catch(() => undefined);
    await bounded(enteredA.promise);
    assert.equal(await recover(b), 1);
    const next = processor(
      b,
      async () => {
        enteredB.resolve();
        await releaseB.promise;
      },
      audit,
      recoveredAt,
    ).process(s.id, 2);
    void next.catch(() => undefined);
    await bounded(enteredB.promise);
    const processing = await snapshot(s.id);
    assert.equal(processing.row.status, 'processing');
    releaseA.resolve();
    await bounded(old);
    assert.deepEqual(await snapshot(s.id), processing);
    releaseB.resolve();
    await bounded(next);
    assert.equal((await snapshot(s.id)).logs.length, 1);
  });

  await scenario('Audit failure rolls back both the transition and inserted Audit', async () => {
    const s = await makeSchedule();
    const failingAudit = new AuditService(
      {
        async insert(record, manager) {
          await auditRepository.insert(record, manager);
          throw new Error('injected Audit persistence failure');
        },
      },
      clock,
    );
    await assert.rejects(
      () => processor(a, async () => {}, failingAudit).process(s.id, 1),
      /injected Audit persistence failure/u,
    );
    const rolledBack = await snapshot(s.id);
    assert.equal(rolledBack.row.status, 'processing');
    assert.equal(rolledBack.row.version, 2);
    assert.equal(rolledBack.logs.length, 0);
    assert.equal(
      await complete(a, {
        scheduleId: s.id,
        workspaceId: s.workspace,
        attemptNumber: 1,
        version: 2,
      }),
      true,
    );
  });

  console.log(JSON.stringify({ result: 'success', scenarios: passed, migrations: files.length }));
} finally {
  for (const connection of [a, b, runner]) {
    if (connection.isTransactionActive) await connection.rollbackTransaction();
  }
  if (ownsSchema) await runner.query(`DROP SCHEMA "${schema}" CASCADE`);
  await Promise.all([a.release(), b.release(), runner.release()]);
  await ds.destroy();
}
