import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// This is a disposable-database acceptance suite, never an operational migration runner.
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.ATLAS_ALLOW_SCHEDULER_LEGACY_HTTP_TESTS, '1');
const url = new URL(process.env.DATABASE_URL ?? '');
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.equal(url.pathname, '/atlas_scheduler_legacy_http_test');
assert.equal(url.search, '');
assert.equal(url.hash, '');
assert.equal(process.env.PORT, '4000');
const base = 'http://127.0.0.1:4000/api';
const require = createRequire(resolve('packages/database/package.json'));
const { DataSource } = require('typeorm');
const { atlasDataSource } = require(resolve('packages/database/dist/data-source.js'));
const {
  ActorType,
  Argon2idPasswordHasher,
  AuditService,
  FixedClock,
  TypeOrmAuditRepository,
  TypeOrmEventingRepository,
  createUuidV7,
  requestContext,
} = require('@atlas/server');
const directory = resolve('packages/database/dist/migrations');
const files = readdirSync(directory).filter((file) => /^\d+-.+\.js$/u.test(file)).sort();
const boundary = files.indexOf('1788664800000-CreatePublicationScheduleEffects.js');
assert.ok(boundary > 0, 'The real target-required migration must be present.');
const migrations = files.map((file) => {
  const classes = Object.values(require(resolve(directory, file))).filter(
    (value) => typeof value === 'function' && typeof value.prototype.up === 'function',
  );
  assert.equal(classes.length, 1, file);
  return classes[0];
});
function connection(selected) {
  return new DataSource({
    ...atlasDataSource.options,
    url: url.href,
    migrations: selected,
    synchronize: false,
    migrationsRun: false,
    logging: false,
    extra: { options: '-c lock_timeout=5000 -c statement_timeout=30000' },
  });
}
let db = connection(migrations.slice(0, boundary));
let api;
let apiLog;
let requests = 0;
const passed = [];
const historical = new Date('2026-01-01T00:00:00Z');
const due = new Date('2026-01-01T00:01:00Z');
const failedAt = new Date('2026-01-01T00:02:00Z');
const diagnostic = 'legacy-fixture-raw-diagnostic-must-not-be-disclosed';
const output = resolve('tmp/r05f-legacy-http');
mkdirSync(output, { recursive: true });

async function scenario(name, work) {
  await work();
  passed.push(name);
  console.log(`ok ${passed.length} - ${name}`);
}
async function http(path, { method = 'GET', body, session, csrf = true, expected = 200 } = {}) {
  const headers = new Headers({ accept: 'application/json' });
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (session) {
    headers.set('cookie', session.cookies);
    if (csrf) headers.set('x-csrf-token', csrf === true ? session.csrf : csrf);
  }
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
    redirect: 'error',
  });
  requests += 1;
  const result = await response.json();
  // Authentication response bodies, cookies and arbitrary diagnostics are never logged.
  assert.equal(response.status, expected, `${method} ${path}: unexpected HTTP status`);
  return { data: result.data ?? result, response };
}
async function seedAccount(role) {
  const id = createUuidV7();
  const email = `legacy-${role}-${id}@atlas.test`;
  const password = `Atlas-legacy-${randomBytes(24).toString('base64url')}`;
  const hash = await new Argon2idPasswordHasher().hash(password);
  await db.query(
    `INSERT INTO admin_accounts
    (id,email,display_name,password_hash,role,status,password_changed_at,created_at,updated_at)
    VALUES($1,$2,'Legacy HTTP fixture',$3,$4,'active',now(),now(),now())`,
    [id, email, hash, role],
  );
  return { id, email, password };
}
async function authenticate(account) {
  const login = (
    await http('/admin/v1/auth/login', {
      method: 'POST',
      body: { email: account.email, password: account.password },
      expected: 202,
    })
  ).data;
  assert.equal(login.nextStep, 'mfa-setup');
  const challenge = { challengeId: login.challengeId, challengeToken: login.challengeToken };
  const enrollment = (
    await http('/admin/v1/auth/mfa/totp/enrollment', { method: 'POST', body: challenge })
  ).data;
  const grant = (
    await http('/admin/v1/auth/mfa/totp/confirm', {
      method: 'POST',
      body: { ...challenge, code: totp(enrollment.secret) },
      expected: 202,
    })
  ).data;
  const result = await http('/admin/v1/auth/session', {
    method: 'POST',
    body: { grantId: grant.grantId, grantToken: grant.grantToken },
    expected: 201,
  });
  const pairs = result.response.headers.getSetCookie().map((value) => value.split(';', 1)[0]);
  const token = pairs.find((value) => value.startsWith('atlas_admin_csrf='));
  assert.ok(token);
  assert.ok(pairs.some((value) => value.startsWith('atlas_admin_session=')));
  const session = {
    cookies: pairs.join('; '),
    csrf: decodeURIComponent(token.split('=').slice(1).join('=')),
  };
  await http('/admin/v1/auth/session', { session });
  return session;
}
async function ready(context, number, admin) {
  const id = createUuidV7();
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO content_revisions
      (id,content_id,workspace_id,revision_number,kind,title,body_markdown,body_html,
      source_draft_version,created_by_admin_account_id,created_at)
      VALUES($1,$2,$3,$4,'ready','Legacy fixture','Fixture body','<p>Fixture body</p>',1,$5,$6)`,
      [id, context.content, context.workspace, number, admin, historical],
    );
    await tx.query(
      `UPDATE contents SET status='ready',current_revision_number=$2,ready_revision_number=$2
      WHERE id=$1`,
      [context.content, number],
    );
  });
  return id;
}
async function seedContext(workspace, admin, action = 'publish', failed = false) {
  const context = {
    workspace,
    content: createUuidV7(),
    site: createUuidV7(),
    assignment: createUuidV7(),
    schedule: createUuidV7(),
    action,
  };
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO sites
      (id,workspace_id,key,name,type,status,timezone,locale,created_at,updated_at)
      VALUES($1,$2,$3,'Legacy fixture','blog','active','UTC','en',$4,$4)`,
      [context.site, workspace, `legacy-${context.site}`, historical],
    );
    await tx.query(
      `INSERT INTO contents
      (id,workspace_id,type,status,created_by_admin_account_id,created_at,updated_at)
      VALUES($1,$2,'post','draft',$3,$4,$4)`,
      [context.content, workspace, admin, historical],
    );
    await tx.query(
      `INSERT INTO content_drafts
      (content_id,workspace_id,title,body_markdown,updated_by_admin_account_id,updated_at)
      VALUES($1,$2,'Legacy fixture','Fixture body',$3,$4)`,
      [context.content, workspace, admin, historical],
    );
    await tx.query(
      `INSERT INTO content_sites
      (id,workspace_id,content_id,site_id,slug,created_at,updated_at)
      VALUES($1,$2,$3,$4,'legacy-fixture',$5,$5)`,
      [context.assignment, workspace, context.content, context.site, historical],
    );
  });
  context.revision = await ready(context, 1, admin);
  const repository = new TypeOrmEventingRepository(db);
  const audit = new AuditService(new TypeOrmAuditRepository(db), new FixedClock(historical));
  const requestId = createUuidV7();
  await requestContext.run(
    {
      requestId,
      traceId: requestId,
      actorType: ActorType.ADMIN,
      actorId: admin,
      workspaceId: workspace,
      siteId: context.site,
    },
    async () => {
      await db.transaction(async (tx) => {
        // Exactly the pre-enforcement R03 fixture path: no target UPDATE or trigger changes.
        await repository.insertPublicationSchedule(
          {
            id: context.schedule,
            workspaceId: workspace,
            siteId: context.site,
            contentId: context.content,
            contentSiteId: context.assignment,
            action,
            scheduledFor: due,
            timezone: 'UTC',
            scheduledLocalAt: '2026-01-01T00:01:00',
            requestedByAdminAccountId: admin,
            createdAt: historical,
          },
          tx,
        );
        await audit.record(
          {
            action: 'content.publication-scheduled',
            targetType: 'publication-schedule',
            targetId: context.schedule,
            result: 'success',
            metadata: { fixture: 'pre-target-enforcement', contentSiteId: context.assignment },
          },
          tx,
        );
      });
      if (failed) {
        const claimed = await db.transaction((tx) =>
          repository.startPublicationScheduleAttempt(context.schedule, 1, failedAt, tx),
        );
        assert.ok(claimed);
        await db.transaction(async (tx) => {
          assert.equal(
            await repository.reschedulePublicationSchedule(
              {
                scheduleId: context.schedule,
                workspaceId: workspace,
                attemptNumber: claimed.attemptCount,
                version: claimed.version,
              },
              failedAt,
              diagnostic,
              true,
              failedAt,
              tx,
            ),
            true,
          );
          await audit.record(
            {
              action: 'content.publication-schedule-failed',
              targetType: 'publication-schedule',
              targetId: context.schedule,
              result: 'failure',
              metadata: { fixture: 'historical-failure', attemptNumber: 1 },
            },
            tx,
          );
        });
      }
    },
  );
  return context;
}
async function legacySnapshot(context) {
  return {
    rows: await db.query('SELECT * FROM publication_schedules WHERE id=$1', [context.schedule]),
    audits: await db.query('SELECT * FROM audit_logs WHERE target_id=$1 ORDER BY id', [
      context.schedule,
    ]),
    outbox: await db.query('SELECT * FROM outbox_events WHERE aggregate_id=$1 ORDER BY id', [
      context.schedule,
    ]),
  };
}
async function scopeSnapshot(context) {
  return {
    legacy: await legacySnapshot(context),
    rows: await db.query(
      'SELECT * FROM publication_schedules WHERE content_site_id=$1 ORDER BY id',
      [context.assignment],
    ),
    effects: await db.query(
      'SELECT * FROM publication_schedule_effects WHERE content_site_id=$1 ORDER BY schedule_id',
      [context.assignment],
    ),
    publications: await db.query(
      'SELECT * FROM content_publications WHERE content_site_id=$1 ORDER BY id',
      [context.assignment],
    ),
  };
}
const listPath = (context) =>
  `/admin/v1/publication-schedules?contentSiteId=${context.assignment}`;
const createPath = (context) =>
  `/admin/v1/contents/${context.content}/sites/${context.assignment}/schedules`;
const cancelPath = (context) => `/admin/v1/publication-schedules/${context.schedule}/cancel`;
const creation = (action) => ({
  action,
  timezone: 'UTC',
  scheduledLocalAt: new Date(Date.now() + 600_000).toISOString().slice(0, 19),
});
async function listed(context, session) {
  const result = await http(listPath(context), { session });
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  return result.data.items;
}
function unresolved(row, status) {
  assert.deepEqual(row.target, { kind: 'unresolved', reason: 'missing-target' });
  assert.equal(row.revisionId, null);
  assert.equal(row.revisionNumber, null);
  assert.equal(row.targetPublicationId, null);
  assert.equal(row.status, status);
  assert.deepEqual(row.operations, { canCancel: status === 'pending', canRetry: false });
  assert.ok(!JSON.stringify(row).includes(diagnostic));
}
async function rejectedWithoutEffects(context, path, options) {
  const before = await scopeSnapshot(context);
  await http(path, options);
  assert.deepEqual(await scopeSnapshot(context), before);
}
async function cancelAndCheck(context, owner, before) {
  const body = { version: before.rows[0].version };
  const cancelled = (
    await http(cancelPath(context), { method: 'POST', body, session: owner })
  ).data;
  unresolved(cancelled, 'cancelled');
  const after = await legacySnapshot(context);
  const row = after.rows[0];
  assert.equal(row.status, 'cancelled');
  assert.equal(row.version, before.rows[0].version + 1);
  assert.ok(row.cancelled_at);
  const { status, version, cancelled_at: cancelledAt, updated_at: updatedAt, ...preserved } = row;
  const {
    status: oldStatus,
    version: oldVersion,
    cancelled_at: oldCancelledAt,
    updated_at: oldUpdatedAt,
    ...original
  } = before.rows[0];
  assert.equal(status, 'cancelled');
  assert.ok(version > oldVersion && cancelledAt && updatedAt);
  assert.equal(oldStatus, 'pending');
  assert.equal(oldCancelledAt, null);
  assert.ok(oldUpdatedAt);
  assert.deepEqual(preserved, original);
  assert.deepEqual(after.outbox, before.outbox);
  assert.deepEqual(
    after.audits.filter((audit) => audit.action !== 'content.publication-schedule-cancelled'),
    before.audits,
  );
  const transactions = await db.query(
    `SELECT s.xmin::text AS schedule_tx,a.xmin::text AS audit_tx
    FROM publication_schedules s JOIN audit_logs a ON a.target_id=s.id
    WHERE s.id=$1 AND a.action='content.publication-schedule-cancelled'`,
    [context.schedule],
  );
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].schedule_tx, transactions[0].audit_tx);
  // The original request is idempotent; neither history nor version is rewritten a second time.
  const repeated = (
    await http(cancelPath(context), { method: 'POST', body, session: owner })
  ).data;
  assert.equal(repeated.version, cancelled.version);
  assert.deepEqual(await legacySnapshot(context), after);
  return after;
}
async function recreate(context, owner, target, historicalSnapshot) {
  const body = creation(context.action);
  const result = (
    await http(createPath(context), { method: 'POST', body, session: owner, expected: 201 })
  ).data;
  assert.notEqual(result.id, context.schedule);
  assert.deepEqual(result.target, target);
  const [stored] = await db.query('SELECT * FROM publication_schedules WHERE id=$1', [result.id]);
  assert.equal(stored.revision_id, target.kind === 'revision' ? target.revisionId : null);
  assert.equal(stored.revision_number, target.kind === 'revision' ? target.revisionNumber : null);
  assert.equal(
    stored.target_publication_id,
    target.kind === 'publication' ? target.publicationId : null,
  );
  assert.equal(stored.status, 'pending');
  assert.deepEqual(await legacySnapshot(context), historicalSnapshot);
  const beforeDuplicate = await scopeSnapshot(context);
  await http(createPath(context), { method: 'POST', body, session: owner, expected: 409 });
  assert.deepEqual(await scopeSnapshot(context), beforeDuplicate);
  const items = await listed(context, owner);
  assert.equal(items.length, 2);
  assert.deepEqual(items.find((item) => item.id === result.id).target, target);
  return result;
}

try {
  await db.initialize();
  const [{ count }] = await db.query(
    "SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'",
  );
  assert.equal(count, 0, 'Refusing an already populated database, including previous test runs.');
  const first = await db.runMigrations({ transaction: 'each' });
  assert.equal(first.length, boundary);
  const [{ id: workspace }] = await db.query('SELECT id FROM workspaces');
  assert.ok(workspace);
  const ownerAccount = await seedAccount('owner');
  const viewerAccount = await seedAccount('viewer');
  const publish = await seedContext(workspace, ownerAccount.id);
  const withdraw = await seedContext(workspace, ownerAccount.id, 'withdraw');
  const failed = await seedContext(workspace, ownerAccount.id, 'publish', true);
  const foreignWorkspace = createUuidV7();
  await db.query(
    `INSERT INTO workspaces(id,key,name,timezone,locale,created_at,updated_at)
    VALUES($1,$2,'Foreign legacy fixture','UTC','en',$3,$3)`,
    [foreignWorkspace, `legacy-${foreignWorkspace}`, historical],
  );
  const foreign = await seedContext(foreignWorkspace, ownerAccount.id);
  const contexts = [publish, withdraw, failed, foreign];
  const beforeMigration = await Promise.all(contexts.map(legacySnapshot));
  assert.equal(beforeMigration[2].rows[0].status, 'failed');
  assert.equal(beforeMigration[2].rows[0].attempt_count, 1);
  assert.equal(beforeMigration[2].audits.length, 2);
  await db.destroy();
  db = connection(migrations);
  await db.initialize();
  const remaining = await db.runMigrations({ transaction: 'each' });
  await scenario('real ordered migrations preserve all legacy rows and original Audit history', async () => {
    assert.equal(remaining.length, migrations.length - boundary);
    assert.equal(await db.showMigrations(), false);
    const history = await db.query('SELECT name FROM atlas_migrations ORDER BY timestamp,id');
    assert.deepEqual(history.map((row) => row.name), migrations.map((Migration) => (new Migration().name ?? Migration.name)));
    assert.deepEqual(await Promise.all(contexts.map(legacySnapshot)), beforeMigration);
    for (const snapshot of beforeMigration) {
      assert.equal(snapshot.rows[0].revision_id, null);
      assert.equal(snapshot.rows[0].revision_number, null);
      assert.equal(snapshot.rows[0].target_publication_id, null);
    }
  });
  await scenario('new targetless inserts remain rejected by the enabled production trigger', async () => {
    const [trigger] = await db.query(
      `SELECT tgenabled FROM pg_trigger WHERE tgrelid='publication_schedules'::regclass
      AND tgname='trg_require_new_publication_schedule_target'`,
    );
    assert.equal(trigger.tgenabled, 'O');
    await assert.rejects(
      db.transaction((tx) => tx.query(
        `INSERT INTO publication_schedules
        (id,workspace_id,site_id,content_id,content_site_id,action,scheduled_for,timezone,
        scheduled_local_at,requested_by_admin_account_id,created_at,updated_at,next_attempt_at)
        VALUES($1,$2,$3,$4,$5,'publish',$6,'UTC','2026-01-01T00:01:00',$7,$6,$6,$6)`,
        [createUuidV7(), workspace, failed.site, failed.content, failed.assignment, due, ownerAccount.id],
      )),
      (error) => (error.driverError?.code ?? error.code) === '23514' && /pinned target/u.test(error.message),
    );
    assert.deepEqual(await legacySnapshot(failed), beforeMigration[2]);
  });
  // Domain fixtures may advance current pointers. No historical Schedule target is ever changed.
  const currentRevision = await ready(publish, 2, ownerAccount.id);
  const failedCurrentRevision = await ready(failed, 2, ownerAccount.id);
  apiLog = openSync(resolve(output, 'api.log'), 'w', 0o600);
  api = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env: process.env,
    stdio: ['ignore', apiLog, apiLog],
  });
  let healthy = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    assert.equal(api.exitCode, null, 'The isolated test API exited before becoming healthy.');
    try {
      const response = await fetch(`${base}/health/live`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) { healthy = true; break; }
    } catch { /* The API may still be starting. */ }
    await delay(500);
  }
  assert.ok(healthy, 'The isolated test API did not become healthy.');
  let owner;
  let viewer;
  await scenario('OWNER and VIEWER authenticate through real Password, TOTP, grant and Session HTTP', async () => {
    owner = await authenticate(ownerAccount);
    viewer = await authenticate(viewerAccount);
    assert.equal((await http('/admin/v1/workspace', { session: owner })).data.id, workspace);
  });
  await http(`/admin/v1/contents/${withdraw.content}/sites/${withdraw.assignment}/publish`, {
    method: 'POST', session: owner, expected: 201,
  });
  const [active] = await db.query(
    "SELECT id FROM content_publications WHERE content_site_id=$1 AND status='active'",
    [withdraw.assignment],
  );
  assert.ok(active);
  await scenario('authenticated views remain unresolved despite current READY and ACTIVE pointers', async () => {
    for (const context of [publish, withdraw, failed]) {
      const rows = await listed(context, viewer);
      assert.equal(rows.length, 1);
      unresolved(rows[0], context === failed ? 'failed' : 'pending');
    }
    assert.deepEqual(await Promise.all(contexts.map(legacySnapshot)), beforeMigration);
  });
  await scenario('anonymous, VIEWER, CSRF and version failures leave pending legacy intent unchanged', async () => {
    await http(listPath(publish), { expected: 401 });
    const body = { version: beforeMigration[0].rows[0].version };
    for (const options of [
      { expected: 401 },
      { session: viewer, expected: 403 },
      { session: owner, csrf: false, expected: 403 },
      { session: owner, csrf: 'wrong-token', expected: 403 },
      { session: owner, body: { version: body.version + 1 }, expected: 409 },
      { session: owner, body: { version: '1' }, expected: 400 },
    ]) {
      await rejectedWithoutEffects(publish, cancelPath(publish), { method: 'POST', body, ...options });
    }
  });
  await scenario('Workspace and ContentSite boundaries reject reads, cancellation and creation', async () => {
    assert.deepEqual(await listed(foreign, owner), []);
    await rejectedWithoutEffects(foreign, cancelPath(foreign), {
      method: 'POST', body: { version: 1 }, session: owner, expected: 404,
    });
    await rejectedWithoutEffects(foreign, createPath(foreign), {
      method: 'POST', body: creation('publish'), session: owner, expected: 404,
    });
    await rejectedWithoutEffects(publish,
      `/admin/v1/contents/${failed.content}/sites/${publish.assignment}/schedules`, {
        method: 'POST', body: creation('publish'), session: owner, expected: 404,
      });
    assert.deepEqual(await legacySnapshot(foreign), beforeMigration[3]);
  });
  await scenario('an open legacy reservation blocks replacement until explicit cancellation', async () => {
    await rejectedWithoutEffects(publish, createPath(publish), {
      method: 'POST', body: creation('publish'), session: owner, expected: 409,
    });
  });
  let cancelledPublish;
  await scenario('authorized legacy cancellation and one Audit commit atomically and idempotently', async () => {
    cancelledPublish = await cancelAndCheck(publish, owner, beforeMigration[0]);
  });
  await scenario('new reservations still require authentication, write permission and matching CSRF', async () => {
    for (const options of [
      { expected: 401 },
      { session: viewer, expected: 403 },
      { session: owner, csrf: false, expected: 403 },
      { session: owner, csrf: 'wrong-token', expected: 403 },
    ]) {
      await rejectedWithoutEffects(publish, createPath(publish), {
        method: 'POST', body: creation('publish'), ...options,
      });
    }
  });
  await scenario('explicit recreation gets a new ID and the current READY while old history stays immutable', async () => {
    await recreate(publish, owner, {
      kind: 'revision', revisionId: currentRevision, revisionNumber: 2,
    }, cancelledPublish);
  });
  await scenario('legacy withdrawal cancellation and recreation pin the actual ACTIVE Publication', async () => {
    const cancelledWithdraw = await cancelAndCheck(withdraw, owner, beforeMigration[1]);
    await recreate(withdraw, owner, {
      kind: 'publication', publicationId: active.id,
    }, cancelledWithdraw);
  });
  await scenario('failed legacy cancellation and retry are rejected without rewriting the failed attempt', async () => {
    const body = { version: beforeMigration[2].rows[0].version };
    for (const action of ['cancel', 'retry']) {
      await rejectedWithoutEffects(failed, `/admin/v1/publication-schedules/${failed.schedule}/${action}`, {
        method: 'POST', body, session: owner, expected: 409,
      });
    }
    assert.deepEqual(await legacySnapshot(failed), beforeMigration[2]);
  });
  await scenario('new scheduling after a failed legacy record preserves failure, attempts and original Audit', async () => {
    await recreate(failed, owner, {
      kind: 'revision', revisionId: failedCurrentRevision, revisionNumber: 2,
    }, beforeMigration[2]);
    const rows = await listed(failed, owner);
    unresolved(rows.find((row) => row.id === failed.schedule), 'failed');
    assert.deepEqual(await legacySnapshot(failed), beforeMigration[2]);
  });
  assert.equal(passed.length, 13);
  const result = {
    result: 'success', scenarios: passed.length, requests, migrations: migrations.length,
    authentication: 'password+totp+session+csrf',
    coverage: 'migration-preservation+authenticated-http-cancel-create',
    workerExecution: false, productionChanges: false, passed,
  };
  writeFileSync(resolve(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  if (api && api.exitCode === null) {
    api.kill('SIGTERM');
    for (let attempt = 0; attempt < 40 && api.exitCode === null; attempt += 1) await delay(100);
    if (api.exitCode === null) api.kill('SIGKILL');
  }
  if (apiLog !== undefined) closeSync(apiLog);
  if (db.isInitialized) await db.destroy();
  // No history deletion, trigger disabling, target repair or production DB cleanup.
}

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let accumulator = 0;
  let bits = 0;
  const bytes = [];
  for (const character of secret.toUpperCase().replace(/=+$/u, '')) {
    const index = alphabet.indexOf(character);
    assert.ok(index >= 0);
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 255);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) - 1));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
