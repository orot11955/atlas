import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { collectEventingPreflight } from '../operations/eventing-rollout-preflight.mjs';

assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.ATLAS_ALLOW_EVENTING_PREFLIGHT_TESTS, '1');
const url = new URL(process.env.DATABASE_URL ?? '');
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.equal(url.pathname, '/atlas_eventing_preflight_test');
assert.equal(url.search, '');
assert.equal(url.hash, '');
const require = createRequire(resolve('packages/database/package.json'));
const { DataSource } = require('typeorm');
const { atlasDataSource } = require(resolve('packages/database/dist/data-source.js'));
const { TypeOrmEventingRepository, createUuidV7 } = require('@atlas/server');
const directory = resolve('packages/database/dist/migrations');
const files = readdirSync(directory).filter((file) => /^\d+-.+\.js$/u.test(file)).sort();
const targetIndex = files.indexOf('1788664800000-CreatePublicationScheduleEffects.js');
const diagnosticIndex = files.indexOf('1788696000000-EnforceWebhookDiagnosticPolicy.js');
assert.ok(targetIndex > 0 && diagnosticIndex > targetIndex);
const migrations = files.map((file) => {
  const classes = Object.values(require(resolve(directory, file))).filter(
    (value) => typeof value === 'function' && typeof value.prototype.up === 'function',
  );
  assert.equal(classes.length, 1);
  return classes[0];
});
function database(selected) {
  return new DataSource({ ...atlasDataSource.options, url: url.href, migrations: selected,
    synchronize: false, migrationsRun: false, logging: false });
}
let db = database(migrations.slice(0, targetIndex));
let reader;
let blocker;
let scenarios = 0;
const now = new Date('2026-01-01T00:00:00Z');
const raw = 'preflight-private-diagnostic-sentinel';
const signedBody = '{"signed":"original-body-sentinel"}';
const admin = createUuidV7();
async function scenario(name, work) {
  await work();
  console.log(`ok ${++scenarios} - ${name}`);
}
async function fixture() {
  const c = Object.fromEntries(['workspace', 'site', 'content', 'assignment', 'schedule', 'event', 'endpoint', 'delivery', 'attempt']
    .map((key) => [key, createUuidV7()]));
  const repository = new TypeOrmEventingRepository(db);
  await db.transaction(async (tx) => {
    await tx.query(`INSERT INTO workspaces(id,key,name,timezone,locale,created_at,updated_at)
      VALUES($1,$2,'Preflight fixture','UTC','en',$3,$3)`, [c.workspace, `w-${c.workspace}`, now]);
    await tx.query(`INSERT INTO sites(id,workspace_id,key,name,type,status,timezone,locale,created_at,updated_at)
      VALUES($1,$2,$3,'Fixture','blog','active','UTC','en',$4,$4)`, [c.site, c.workspace, `s-${c.site}`, now]);
    await tx.query(`INSERT INTO contents(id,workspace_id,type,status,created_by_admin_account_id,created_at,updated_at)
      VALUES($1,$2,'post','draft',$3,$4,$4)`, [c.content, c.workspace, admin, now]);
    await tx.query(`INSERT INTO content_sites(id,workspace_id,content_id,site_id,slug,created_at,updated_at)
      VALUES($1,$2,$3,$4,'fixture',$5,$5)`, [c.assignment, c.workspace, c.content, c.site, now]);
    await repository.insertPublicationSchedule({ id: c.schedule, workspaceId: c.workspace,
      siteId: c.site, contentId: c.content, contentSiteId: c.assignment, action: 'publish',
      scheduledFor: new Date(now.getTime() + 60_000), timezone: 'UTC', scheduledLocalAt: '2026-01-01T00:01:00',
      requestedByAdminAccountId: admin, createdAt: now }, tx);
    await repository.insertOutboxEvent({ id: c.event, workspaceId: c.workspace, siteId: c.site,
      aggregateType: 'content-publication', aggregateId: c.content, eventType: 'content.published',
      schemaVersion: 1, payload: {}, status: 'pending', availableAt: now,
      attemptCount: 0, createdAt: now, updatedAt: now }, tx);
    await repository.insertWebhookEndpoint({ id: c.endpoint, workspaceId: c.workspace, siteId: c.site,
      name: 'Fixture', url: 'https://hooks.example.test', status: 'active', secretCiphertext: 'ciphertext-sentinel',
      secretKeyVersion: 'v1', subscribedEvents: ['content.published'], consecutiveFailureCount: 0,
      version: 1, createdByAdminAccountId: admin, createdAt: now, updatedAt: now }, tx);
    await repository.insertWebhookDeliveryIfAbsent({ id: c.delivery, workspaceId: c.workspace,
      endpointId: c.endpoint, eventId: c.event, eventType: 'content.published', createdAt: now }, tx);
    await tx.query(`UPDATE webhook_deliveries SET status='succeeded',attempt_count=1,completed_at=$2,
      last_response_status=200,last_response_excerpt=$3,last_error=$3 WHERE id=$1`, [c.delivery, now, raw]);
    await tx.query(`INSERT INTO webhook_delivery_attempts(id,delivery_id,attempt_number,status,request_body,
      response_status,response_body_excerpt,error_message,requested_at,completed_at)
      VALUES($1,$2,1,'succeeded',$3,200,$4,$4,$5,$5)`, [c.attempt, c.delivery, signedBody, raw, now]);
  });
  return c;
}
async function snapshot(c) {
  return {
    schedule: await db.query('SELECT * FROM publication_schedules WHERE id=$1', [c.schedule]),
    delivery: await db.query('SELECT * FROM webhook_deliveries WHERE id=$1', [c.delivery]),
    attempts: await db.query('SELECT * FROM webhook_delivery_attempts WHERE delivery_id=$1', [c.delivery]),
    endpoint: await db.query('SELECT * FROM webhook_endpoints WHERE id=$1', [c.endpoint]),
    event: await db.query('SELECT * FROM outbox_events WHERE id=$1', [c.event]),
    audits: await db.query('SELECT * FROM audit_logs ORDER BY id'),
  };
}
try {
  await db.initialize();
  const [{ count }] = await db.query(`SELECT count(*)::int AS count FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'`);
  assert.equal(count, 0, 'A fresh disposable database is mandatory.');
  await db.runMigrations({ transaction: 'each' });
  await db.query(`INSERT INTO admin_accounts(id,email,display_name,password_hash,role,password_changed_at,created_at,updated_at)
    VALUES($1,'preflight@atlas.test','Fixture','$argon2id$fixture-only','owner',$2,$2,$2)`, [admin, now]);
  const own = await fixture();
  const foreign = await fixture();
  await db.destroy();
  db = database(migrations.slice(0, diagnosticIndex));
  await db.initialize();
  await db.runMigrations({ transaction: 'each' });
  reader = db.createQueryRunner();
  await reader.connect();
  await scenario('pre-policy inventory counts real legacy diagnostics without disclosing or changing rows', async () => {
    const before = await snapshot(own);
    const foreignBefore = await snapshot(foreign);
    const report = await collectEventingPreflight(reader, own.workspace);
    assert.equal(report.diagnosticPolicyApplied, false);
    assert.equal(report.schedules.total, '1');
    assert.equal(report.schedules.pending_missing_target, '1');
    for (const row of Object.values(report.diagnostics)) {
      assert.equal(row.total, '1');
      assert.equal(row.rewrite_candidates, '1');
    }
    for (const value of [raw, signedBody, 'ciphertext-sentinel', foreign.workspace, own.endpoint, own.delivery]) {
      assert.ok(!JSON.stringify(report).includes(value));
    }
    assert.equal(report.deploymentAuthorized, false);
    assert.deepEqual(await snapshot(own), before);
    assert.deepEqual(await snapshot(foreign), foreignBefore);
  });
  await scenario('PostgreSQL itself rejects writes inside the collector transaction', async () => {
    const before = await snapshot(own);
    const query = reader.query.bind(reader);
    reader.query = async (sql, parameters) => {
      if (sql.startsWith('SELECT id FROM public.workspaces')) {
        await query('UPDATE public.workspaces SET name=name WHERE id=$1', [own.workspace]);
      }
      return query(sql, parameters);
    };
    try {
      await assert.rejects(collectEventingPreflight(reader, own.workspace),
        (error) => (error.driverError?.code ?? error.code) === '25006');
    } finally { reader.query = query; }
    assert.equal(reader.isTransactionActive, false);
    assert.deepEqual(await snapshot(own), before);
  });
  await scenario('unknown Workspace fails closed and releases the transaction', async () => {
    await assert.rejects(collectEventingPreflight(reader, createUuidV7()), /Workspace not found/u);
    assert.equal(reader.isTransactionActive, false);
  });
  await scenario('blocking table locks time out without changing or weakening the query', async () => {
    blocker = db.createQueryRunner();
    await blocker.connect();
    await blocker.startTransaction();
    await blocker.query('LOCK TABLE public.publication_schedules IN ACCESS EXCLUSIVE MODE');
    try {
      await assert.rejects(collectEventingPreflight(reader, own.workspace),
        (error) => (error.driverError?.code ?? error.code) === '55P03');
    } finally { await blocker.rollbackTransaction(); await blocker.release(); blocker = undefined; }
    assert.equal(reader.isTransactionActive, false);
    assert.equal((await collectEventingPreflight(reader, own.workspace)).schedules.total, '1');
  });
  await reader.release();
  reader = undefined;
  await db.destroy();
  db = database(migrations);
  await db.initialize();
  await db.runMigrations({ transaction: 'each' });
  assert.equal(await db.showMigrations(), false);
  reader = db.createQueryRunner();
  await reader.connect();
  await scenario('post-policy inventory sees zero rewrites and leaves legacy targets and signed history intact', async () => {
    const before = await snapshot(own);
    const report = await collectEventingPreflight(reader, own.workspace);
    assert.equal(report.diagnosticPolicyApplied, true);
    assert.equal(report.schedules.missing_target, '1');
    for (const row of Object.values(report.diagnostics)) assert.equal(row.rewrite_candidates, '0');
    assert.equal(before.attempts[0].request_body, signedBody);
    assert.equal(before.schedule[0].revision_id, null);
    assert.equal(before.schedule[0].target_publication_id, null);
    assert.deepEqual(await snapshot(own), before);
  });
  await scenario('actual standalone CLI needs no key material and returns a read-only inventory', async () => {
    const child = spawnSync(process.execPath, ['scripts/operations/eventing-rollout-preflight.mjs',
      '--workspace', own.workspace], { encoding: 'utf8', timeout: 20_000, maxBuffer: 1_000_000,
      env: { ...process.env, ATLAS_EVENTING_PREFLIGHT_DATABASE_URL: url.href } });
    assert.equal(child.status, 0, 'Standalone preflight failed.');
    const report = JSON.parse(child.stdout);
    assert.equal(report.readOnly, true);
    assert.equal(report.diagnosticPolicyApplied, true);
    assert.equal(report.schedules.missing_target, '1');
    assert.equal(report.keyRetirementAuthorized, false);
    assert.equal(child.stderr, '');
  });
  assert.equal(scenarios, 6);
  const result = { result: 'success', scenarios, migrations: migrations.length,
    checkoutSha: process.env.GITHUB_SHA ?? null,
    database: 'isolated-test-only', productionChanges: false };
  mkdirSync('tmp/r05g-preflight', { recursive: true });
  writeFileSync('tmp/r05g-preflight/result.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  if (blocker && !blocker.isReleased) {
    if (blocker.isTransactionActive) await blocker.rollbackTransaction();
    await blocker.release();
  }
  if (reader && !reader.isReleased) await reader.release();
  if (db.isInitialized) await db.destroy();
}
