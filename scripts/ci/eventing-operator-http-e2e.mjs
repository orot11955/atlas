import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// This suite seeds accounts and domain fixtures, never authenticated Sessions or CSRF tokens.
// All operator commands under test travel through the running production HTTP application.
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.ATLAS_ALLOW_OPERATOR_HTTP_TESTS, '1');
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname));
assert.equal(databaseUrl.pathname, '/atlas_operator_http_test');
assert.equal(databaseUrl.search, '');
assert.equal(databaseUrl.hash, '');
const base = new URL(process.env.ATLAS_OPERATOR_API_URL ?? '');
assert.equal(base.origin, 'http://127.0.0.1:4000');
assert.equal(base.pathname, '/api');
assert.equal(base.search, '');
assert.equal(base.hash, '');
assert.equal(base.username, '');
assert.equal(base.password, '');
const require = createRequire(resolve('packages/database/package.json'));
const { DataSource, getMetadataArgsStorage } = require('typeorm');
const {
  Argon2idPasswordHasher,
  TypeOrmEventingRepository,
  CONSUMER_KEY,
  createUuidV7,
} = require('@atlas/server');
const db = new DataSource({
  type: 'postgres',
  url: databaseUrl.href,
  entities: [...new Set(getMetadataArgsStorage().tables.map((table) => table.target))],
  synchronize: false,
  migrationsRun: false,
  logging: false,
  extra: { options: '-c lock_timeout=5000 -c statement_timeout=15000' },
});
await db.initialize();
const repository = new TypeOrmEventingRepository(db);
let scenarios = 0;
let requests = 0;

async function scenario(name, work) {
  await work();
  scenarios += 1;
  console.log(`ok ${scenarios} - ${name}`);
}
async function http(path, { method = 'GET', body, session, csrf = true, expected = 200 } = {}) {
  const headers = new Headers({ accept: 'application/json' });
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (session) {
    headers.set('cookie', session.cookies);
    if (csrf) headers.set('x-csrf-token', csrf === true ? session.csrf : csrf);
  }
  const response = await fetch(`${base.href}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
    redirect: 'error',
  });
  requests += 1;
  const result = await response.json();
  // Never echo an authentication response or arbitrary error detail on failure.
  assert.equal(response.status, expected, `${method} ${path}: unexpected HTTP status`);
  return { data: result.data ?? result, response };
}
async function account(role) {
  const id = createUuidV7();
  const email = `operator-${role}-${id}@atlas.test`;
  const password = `Atlas-operator-${randomBytes(24).toString('base64url')}`;
  const hash = await new Argon2idPasswordHasher().hash(password);
  await db.query(`INSERT INTO admin_accounts
    (id,email,display_name,password_hash,role,status,password_changed_at,created_at,updated_at)
    VALUES($1,$2,'Operator HTTP fixture',$3,$4,'active',now(),now(),now())`, [id, email, hash, role]);
  const login = (await http('/admin/v1/auth/login', {
    method: 'POST', body: { email, password }, expected: 202,
  })).data;
  assert.equal(login.nextStep, 'mfa-setup');
  const challenge = { challengeId: login.challengeId, challengeToken: login.challengeToken };
  const enrollment = (await http('/admin/v1/auth/mfa/totp/enrollment', {
    method: 'POST', body: challenge,
  })).data;
  const grant = (await http('/admin/v1/auth/mfa/totp/confirm', {
    method: 'POST',
    body: { ...challenge, code: totp(enrollment.secret) },
    expected: 202,
  })).data;
  const response = await http('/admin/v1/auth/session', {
    method: 'POST',
    body: { grantId: grant.grantId, grantToken: grant.grantToken },
    expected: 201,
  });
  const pairs = response.response.headers.getSetCookie().map((value) => value.split(';', 1)[0]);
  const token = pairs.find((value) => value.startsWith('atlas_admin_csrf='));
  assert.ok(token);
  assert.ok(pairs.some((value) => value.startsWith('atlas_admin_session=')));
  const session = { cookies: pairs.join('; '), csrf: decodeURIComponent(token.split('=').slice(1).join('=')) };
  await http('/admin/v1/auth/session', { session });
  return session;
}
async function site(workspace) {
  const id = createUuidV7();
  await db.query(`INSERT INTO sites
    (id,workspace_id,key,name,type,status,timezone,locale,created_at,updated_at)
    VALUES($1,$2,$3,'Operator fixture','blog','active','UTC','en',now(),now())`,
  [id, workspace, `operator-${id}`]);
  return id;
}
async function event(workspace, siteId, { succeeded = false, invalid = false } = {}) {
  const id = createUuidV7();
  const aggregate = createUuidV7();
  const at = new Date(Date.now() - 3_600_000);
  await db.transaction((m) => repository.insertOutboxEvent({
    id, workspaceId: workspace, siteId, aggregateId: aggregate,
    aggregateType: 'content-publication', eventType: 'content.published', schemaVersion: 1,
    payload: {
      eventId: id, workspaceId: workspace, siteId, aggregateId: aggregate,
      eventType: 'content.published', schemaVersion: invalid ? 2 : 1, occurredAt: at.toISOString(),
      data: { publicationId: aggregate, contentId: createUuidV7(), contentSiteId: createUuidV7(),
        revisionId: createUuidV7(), revisionNumber: 1, slug: 'operator', etag: 'a'.repeat(64),
        visibility: 'public', extension: 'payload-not-for-operator-view' },
    },
    status: 'dispatched', availableAt: at, dispatchedAt: at,
    attemptCount: 1, createdAt: at, updatedAt: at,
  }, m));
  // Prepare terminal fixtures using the actual claim/finish repository, including attempt history.
  // No Worker runs in this suite, so a replay can be inspected before later queue execution.
  for (let attempt = 1; attempt <= (succeeded ? 1 : 5); attempt += 1) {
    const time = new Date(at.getTime() + (attempt - 1) * 601_000);
    await db.transaction(async (m) => {
      const row = await repository.claimEventConsumption(id, CONSUMER_KEY, time, new Date(time.getTime() - 30_000), m);
      assert.ok(row);
      assert.equal(await repository.completeEventConsumption({
        consumptionId: row.id, eventId: id, consumerKey: CONSUMER_KEY,
        workspaceId: workspace, attemptNumber: row.attemptCount,
      }, succeeded ? 'succeeded' : 'failed', { processedAt: time }, m), true);
    });
  }
  return id;
}
async function snapshot(eventId) {
  return {
    event: await db.query('SELECT * FROM outbox_events WHERE id=$1', [eventId]),
    receipt: await db.query('SELECT * FROM event_consumptions WHERE event_id=$1', [eventId]),
    replays: await db.query(`SELECT r.* FROM event_consumption_replays r JOIN event_consumptions c
      ON c.id=r.consumption_id WHERE c.event_id=$1 ORDER BY r.id`, [eventId]),
    attempts: await db.query(`SELECT a.* FROM event_consumption_attempts a JOIN event_consumptions c
      ON c.id=a.consumption_id WHERE c.event_id=$1 ORDER BY a.attempt_number`, [eventId]),
    audits: await db.query(`SELECT * FROM audit_logs WHERE target_id=$1
      AND action='outbox.consumption-replay-requested' ORDER BY id`, [eventId]),
  };
}

try {
  const [{ count }] = await db.query('SELECT count(*)::int AS count FROM admin_accounts');
  assert.equal(count, 0, 'This fixture requires a fresh disposable database.');
  let owner;
  let viewer;
  await scenario('real Password, TOTP enrollment, grant and Session authenticate OWNER and VIEWER', async () => {
    owner = await account('owner');
    viewer = await account('viewer');
  });
  const workspace = (await http('/admin/v1/workspace', { session: owner })).data.id;
  const mainSite = await site(workspace);
  const otherWorkspace = createUuidV7();
  await db.query(`INSERT INTO workspaces (id,key,name,timezone,locale,created_at,updated_at)
    VALUES($1,$2,'Other fixture','UTC','en',now(),now())`, [otherWorkspace, `operator-${otherWorkspace}`]);
  const foreignSite = await site(otherWorkspace);
  const dead = await event(workspace, mainSite);
  const foreign = await event(otherWorkspace, foreignSite);
  const done = await event(workspace, mainSite, { succeeded: true });
  const invalid = await event(workspace, mainSite, { invalid: true });
  const replay = { replayId: createUuidV7(), expectedAttempt: 5, reason: 'operator-reviewed' };
  const route = `/admin/v1/eventing/consumptions/${dead}/replay`;
  const before = await snapshot(dead);

  await scenario('anonymous operator reads and writes require a Session', async () => {
    await http('/admin/v1/eventing/consumptions', { expected: 401 });
    await http(`/admin/v1/eventing/consumptions/${dead}/history`, { expected: 401 });
    await http(route, { method: 'POST', body: replay, expected: 401 });
  });
  await scenario('VIEWER can inspect scoped receipts but cannot replay', async () => {
    const list = await http('/admin/v1/eventing/consumptions?status=dead&limit=200', { session: viewer });
    assert.ok(list.data.items.some((item) => item.eventId === dead));
    assert.ok(!list.data.items.some((item) => item.eventId === foreign));
    await http(`/admin/v1/eventing/consumptions/${dead}/history`, { session: viewer });
    await http(route, { method: 'POST', body: replay, session: viewer, expected: 403 });
  });
  await scenario('missing and mismatched CSRF are rejected before Replay mutation', async () => {
    await http(route, { method: 'POST', body: replay, session: owner, csrf: false, expected: 403 });
    await http(route, { method: 'POST', body: replay, session: owner, csrf: 'wrong-token', expected: 403 });
  });
  await scenario('cross-Workspace identifiers do not disclose history or permit Replay', async () => {
    await http(`/admin/v1/eventing/consumptions/${foreign}/history`, { session: owner, expected: 404 });
    await http(`/admin/v1/eventing/consumptions/${foreign}/replay`, {
      method: 'POST', body: replay, session: owner, expected: 404,
    });
  });
  await scenario('invalid body fields, bounds and optimistic attempt are rejected', async () => {
    for (const patch of [{ expectedAttempt: '5' }, { expectedAttempt: 0 }, { reason: 'arbitrary' }, { payload: {} }]) {
      await http(route, { method: 'POST', body: { ...replay, ...patch }, session: owner, expected: 400 });
    }
    await http(route, { method: 'POST', body: { ...replay, expectedAttempt: 4 }, session: owner, expected: 409 });
    await http('/admin/v1/eventing/consumptions?limit=201', { session: owner, expected: 400 });
    await http('/admin/v1/eventing/consumptions?status=unknown', { session: owner, expected: 400 });
    assert.deepEqual(await snapshot(dead), before);
  });
  await scenario('successful and invalid-contract receipts cannot be replayed', async () => {
    await http(`/admin/v1/eventing/consumptions/${done}/replay`, {
      method: 'POST', body: { ...replay, expectedAttempt: 1 }, session: owner, expected: 409,
    });
    await http(`/admin/v1/eventing/consumptions/${invalid}/replay`, {
      method: 'POST', body: replay, session: owner, expected: 400,
    });
  });
  await scenario('authorized Replay preserves immutable Event and attempts and commits one Audit', async () => {
    const result = await http(route, { method: 'POST', body: replay, session: owner, expected: 202 });
    assert.equal(result.response.headers.get('cache-control'), 'no-store');
    assert.equal(result.data.replayed, false);
    assert.equal(result.data.previousAttempt, 5);
    assert.equal(result.data.attemptLimit, 10);
    const after = await snapshot(dead);
    assert.deepEqual(after.event, before.event);
    assert.deepEqual(after.attempts, before.attempts);
    assert.equal(after.receipt[0].status, 'pending');
    assert.equal(after.receipt[0].attempt_count, 5);
    assert.equal(after.receipt[0].cycle_start_attempt, 5);
    assert.equal(after.replays.length, 1);
    assert.equal(after.audits.length, 1);
  });
  await scenario('identical Replay is idempotent and a conflicting Replay ID is rejected', async () => {
    const stable = await snapshot(dead);
    const repeated = await http(route, { method: 'POST', body: replay, session: owner, expected: 202 });
    assert.equal(repeated.data.replayed, true);
    await http(route, {
      method: 'POST', body: { ...replay, reason: 'dependency-restored' }, session: owner, expected: 409,
    });
    assert.deepEqual(await snapshot(dead), stable);
  });
  await scenario('history and receipt HTTP views exclude payloads and raw diagnostics', async () => {
    const history = await http(`/admin/v1/eventing/consumptions/${dead}/history?limit=50`, { session: owner });
    assert.equal(history.response.headers.get('cache-control'), 'no-store');
    assert.equal(history.data.attempts.length, 5);
    assert.equal(history.data.replays.length, 1);
    const list = await http('/admin/v1/eventing/consumptions?limit=200', { session: owner });
    assert.doesNotMatch(JSON.stringify([history.data, list.data]), /payload-not-for-operator-view|payload_json|last_error|password_hash/u);
  });

  let content;
  let assignment;
  let schedule;
  await scenario('authenticated schedule creation returns the exact persisted READY target', async () => {
    content = (await http('/admin/v1/contents', {
      method: 'POST', session: owner, expected: 201,
      body: { type: 'post', title: 'Operator HTTP content', bodyMarkdown: 'A meaningful operator test body.' },
    })).data;
    content = (await http(`/admin/v1/contents/${content.id}/ready`, {
      method: 'POST', session: owner, expected: 201,
      body: { contentVersion: content.version, draftVersion: content.draft.draftVersion, note: 'Operator READY' },
    })).data;
    assignment = (await http(`/admin/v1/contents/${content.id}/sites`, {
      method: 'POST', session: owner, expected: 201,
      body: { siteId: mainSite, slug: 'operator-http', visibility: 'public', seo: {} },
    })).data;
    schedule = (await http(`/admin/v1/contents/${content.id}/sites/${assignment.id}/schedules`, {
      method: 'POST', session: owner, expected: 201,
      body: { action: 'publish', timezone: 'UTC', scheduledLocalAt: new Date(Date.now() + 300_000).toISOString().slice(0, 19) },
    })).data;
    const [revision] = await db.query(`SELECT id,revision_number FROM content_revisions
      WHERE content_id=$1 AND kind='ready' ORDER BY revision_number DESC LIMIT 1`, [content.id]);
    assert.deepEqual(schedule.target, { kind: 'revision', revisionId: revision.id, revisionNumber: revision.revision_number });
    assert.deepEqual(schedule.operations, { canCancel: true, canRetry: false });
    const listed = await http(`/admin/v1/publication-schedules?contentSiteId=${assignment.id}`, { session: owner });
    assert.equal(listed.response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(listed.data.items[0].target, schedule.target);
  });
  await scenario('schedule cancellation enforces CSRF, permission and optimistic version', async () => {
    const path = `/admin/v1/publication-schedules/${schedule.id}/cancel`;
    const body = { version: schedule.version };
    await http(path, { method: 'POST', body, session: owner, csrf: false, expected: 403 });
    await http(path, { method: 'POST', body, session: viewer, expected: 403 });
    await http(path, { method: 'POST', body: { version: schedule.version + 1 }, session: owner, expected: 409 });
    const cancelled = (await http(path, { method: 'POST', body, session: owner })).data;
    assert.equal(cancelled.status, 'cancelled');
    assert.deepEqual(cancelled.target, schedule.target);
    assert.deepEqual(cancelled.operations, { canCancel: false, canRetry: false });
    const repeated = (await http(path, { method: 'POST', body, session: owner })).data;
    assert.equal(repeated.version, cancelled.version);
    const [{ count: audits }] = await db.query(`SELECT count(*)::int AS count FROM audit_logs
      WHERE target_id=$1 AND action='content.publication-schedule-cancelled'`, [schedule.id]);
    assert.equal(audits, 1);
  });
  await scenario('withdraw schedule exposes the exact active Publication identity', async () => {
    await http(`/admin/v1/contents/${content.id}/sites/${assignment.id}/publish`, {
      method: 'POST', session: owner, expected: 201,
    });
    const [active] = await db.query(`SELECT id FROM content_publications WHERE content_site_id=$1 AND status='active'`, [assignment.id]);
    const withdraw = (await http(`/admin/v1/contents/${content.id}/sites/${assignment.id}/schedules`, {
      method: 'POST', session: owner, expected: 201,
      body: { action: 'withdraw', timezone: 'UTC', scheduledLocalAt: new Date(Date.now() + 300_000).toISOString().slice(0, 19) },
    })).data;
    assert.deepEqual(withdraw.target, { kind: 'publication', publicationId: active.id });
    assert.equal(withdraw.revisionId, null);
    assert.equal(withdraw.targetPublicationId, active.id);
  });
  assert.equal(scenarios, 13);
  console.log(JSON.stringify({ result: 'success', scenarios, requests, authentication: 'password+totp+session+csrf' }));
} finally {
  // Only this fresh isolated database is used. Immutable histories are not deleted;
  // the owning CI service is discarded after the suite. No cleanup touches other DBs.
  await db.destroy();
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
