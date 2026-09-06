import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// Only this explicitly named, loopback test database is accepted. Never use DATABASE_URL.
const url = new URL(process.env.ATLAS_EVENTING_ATTEMPT_TEST_DATABASE_URL ?? '');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.ATLAS_ALLOW_EVENTING_ATTEMPT_TESTS, '1');
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.equal(url.pathname, '/atlas_eventing_attempt_test');
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
  OutboxConsumerService,
  OutboxRelayService,
  WebhookDeliveryService,
  OutboxEventEntity,
  EventConsumptionEntity,
  WebhookEndpointEntity,
  WebhookDeliveryEntity,
  WebhookDeliveryAttemptEntity,
  TypeOrmAuditRepository,
  TypeOrmEventingRepository,
} = require('@atlas/server');
const schema = `atlas_r04b_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^atlas_r04b_[0-9a-f]{32}$/u);
const ds = new DataSource({
  type: 'postgres',
  url: url.href,
  schema,
  entities: [PublicationScheduleEntity, AuditLogEntity, OutboxEventEntity, EventConsumptionEntity,
    WebhookEndpointEntity, WebhookDeliveryEntity, WebhookDeliveryAttemptEntity],
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

const options = {
  outboxBatchSize: 100, outboxStaleMilliseconds: 30_000,
  webhookBatchSize: 100, webhookStaleMilliseconds: 30_000,
  publicationBatchSize: 100, publicationStaleMilliseconds: 30_000,
  maximumAttempts: 3,
};
const noQueue = {
  enqueueOutboxEvent: async () => {}, enqueueWebhookDelivery: async () => {},
  enqueuePublicationSchedule: async () => {},
};
const cipher = { decrypt: () => 's'.repeat(48) };

function ownerOfEvent(event) {
  assert.ok(event);
  return { eventId: event.id, workspaceId: event.workspaceId, attemptNumber: event.attemptCount };
}
function ownerOfConsumption(record, workspaceId) {
  assert.ok(record);
  return { consumptionId: record.id, eventId: record.eventId, consumerKey: record.consumerKey,
    attemptNumber: record.attemptCount, workspaceId };
}
function ownerOfWebhook(execution) {
  assert.ok(execution);
  return { deliveryId: execution.delivery.id, workspaceId: execution.delivery.workspaceId,
    endpointId: execution.endpoint.id, endpointVersion: execution.endpoint.version,
    attemptId: execution.attempt.id, attemptNumber: execution.attempt.attemptNumber };
}
function relay(connection, queue = noQueue, at = startedAt) {
  return new OutboxRelayService({ run: (work) => transaction(connection, work) }, repository, queue, options, new FixedClock(at));
}
function consumer(connection, queue = noQueue, auditService = audit, at = startedAt, afterClaim) {
  return new OutboxConsumerService({ run: async (work) => {
    const result = await transaction(connection, work);
    if (afterClaim && result?.consumerKey) await afterClaim();
    return result;
  } }, repository, queue, auditService, { staleMilliseconds: 30_000 }, new FixedClock(at));
}
function webhook(connection, send = async () => ({ status: 200 }), auditService = audit, at = startedAt) {
  return new WebhookDeliveryService({ run: (work) => transaction(connection, work) }, repository,
    { send: async (input) => { assert.equal(connection.isTransactionActive, false); return send(input); } },
    cipher, auditService, { timeoutMilliseconds: 1_000, endpointFailureThreshold: 2 }, new FixedClock(at));
}
async function makeEvent(status = 'dispatched') {
  const context = await transaction(runner, () => makeContext());
  const eventId = randomUUID();
  const envelope = { eventId, eventType: 'content.published', occurredAt: startedAt.toISOString(),
    workspaceId: context.workspace, siteId: context.site, aggregateId: context.publication, schemaVersion: 1, data: {} };
  await transaction(runner, (manager) => repository.insertOutboxEvent({
    id: eventId, workspaceId: context.workspace, siteId: context.site, aggregateType: 'content-publication',
    aggregateId: context.publication, eventType: 'content.published', schemaVersion: 1, payload: envelope,
    status, availableAt: startedAt, dispatchedAt: status === 'dispatched' ? startedAt : undefined,
    attemptCount: status === 'pending' ? 0 : 1, createdAt: startedAt, updatedAt: startedAt,
  }, manager));
  return { ...context, eventId };
}
async function makeEndpoint(event) {
  const endpointId = randomUUID();
  await transaction(runner, (manager) => repository.insertWebhookEndpoint({
    id: endpointId, workspaceId: event.workspace, siteId: event.site, name: 'Ownership receiver',
    url: `https://hooks.example.com/${endpointId}`, status: 'active', secretCiphertext: 'fixture', secretKeyVersion: 'v1',
    subscribedEvents: ['content.published'], consecutiveFailureCount: 1, version: 1,
    createdByAdminAccountId: admin, createdAt: startedAt, updatedAt: startedAt,
  }, manager));
  return { ...event, endpointId };
}
async function makeDelivery(attemptCount = 0) {
  const context = await makeEndpoint(await makeEvent());
  const deliveryId = randomUUID();
  await transaction(runner, (manager) => repository.insertWebhookDeliveryIfAbsent({
    id: deliveryId, workspaceId: context.workspace, endpointId: context.endpointId,
    eventId: context.eventId, eventType: 'content.published', createdAt: startedAt,
  }, manager));
  if (attemptCount) await runner.query('UPDATE webhook_deliveries SET attempt_count = $2 WHERE id = $1', [deliveryId, attemptCount]);
  return { ...context, deliveryId };
}
async function snapshot(context) {
  const [event] = await runner.query('SELECT * FROM outbox_events WHERE id = $1', [context.eventId]);
  const consumptions = await runner.query('SELECT * FROM event_consumptions WHERE event_id = $1 ORDER BY id', [context.eventId]);
  const deliveries = await runner.query('SELECT * FROM webhook_deliveries WHERE event_id = $1 ORDER BY id', [context.eventId]);
  const attempts = await runner.query(`SELECT attempt.* FROM webhook_delivery_attempts attempt
    JOIN webhook_deliveries delivery ON delivery.id = attempt.delivery_id WHERE delivery.event_id = $1 ORDER BY attempt.id`, [context.eventId]);
  const endpoints = await runner.query('SELECT * FROM webhook_endpoints WHERE workspace_id = $1 ORDER BY id', [context.workspace]);
  const logs = await runner.query('SELECT * FROM audit_logs WHERE workspace_id = $1 ORDER BY id', [context.workspace]);
  return { event, consumptions, deliveries, attempts, endpoints, logs };
}
async function claimEvent(connection, at = startedAt) {
  const events = await transaction(connection, (manager) => repository.claimAvailableOutboxEvents(at,
    new Date(at.getTime() - 30_000), 100, manager));
  assert.equal(events.length, 1);
  return events[0];
}
async function finishEvent(connection, owner) {
  return transaction(connection, (manager) => repository.markOutboxEventDispatched(owner, recoveredAt, manager));
}
async function claimWebhook(connection, deliveryId, attempt = 1, at = startedAt) {
  return transaction(connection, (manager) => repository.startWebhookDeliveryAttempt(deliveryId,
    { id: randomUUID(), attemptNumber: attempt, requestedAt: at }, manager));
}
async function recoverWebhook(connection) {
  return transaction(connection, (manager) => repository.recoverStaleWebhookDeliveries(staleBefore, recoveredAt, manager));
}
async function finishWebhook(connection, owner, status = 'succeeded', at = recoveredAt) {
  return transaction(connection, (manager) => repository.finishWebhookDeliveryExecution(owner, {
    status, finishedAt: at, endpointFailureThreshold: 2,
    nextRetryAt: status === 'retry_scheduled' ? new Date(at.getTime() + 60_000) : undefined,
  }, manager));
}

try {
  await runner.query(`CREATE SCHEMA "${schema}"`);
  ownsSchema = true;
  const migrationDirectory = resolve(root, 'packages/database/dist/migrations');
  const files = readdirSync(migrationDirectory).filter((file) => /^\d+-.+\.js$/u.test(file)).sort();
  assert.ok(files.includes('1788652800000-ExpandPublicationScheduleTargets.js'));
  await transaction(runner, async () => {
    for (const file of files) {
      const classes = Object.values(require(resolve(migrationDirectory, file)))
        .filter((value) => typeof value === 'function' && typeof value.prototype.up === 'function');
      assert.equal(classes.length, 1, file);
      await new classes[0]().up(runner);
    }
    await runner.query(`INSERT INTO admin_accounts (id, email, display_name, password_hash, role,
      password_changed_at, created_at, updated_at) VALUES ($1, 'eventing-attempt@atlas.test', 'Fixture',
      '$argon2id$fixture-only', 'owner', now(), now(), now())`, [admin]);
  });
  console.log(`Applied ${files.length} real migrations; independent worker sessions ${pidA}/${pidB}`);

  await scenario('outbox claims skip a row locked by another worker', async () => {
    const context = await makeEvent('pending');
    await a.startTransaction();
    const events = await repository.claimAvailableOutboxEvents(startedAt, staleBefore, 100, a.manager);
    assert.equal(events.length, 1);
    const others = await transaction(b, (manager) => repository.claimAvailableOutboxEvents(startedAt, staleBefore, 100, manager));
    assert.equal(others.length, 0);
    await a.commitTransaction();
    assert.equal(await finishEvent(a, ownerOfEvent(events[0])), true);
    assert.equal((await snapshot(context)).event.status, 'dispatched');
  });

  for (const outcome of ['success', 'failure']) {
    await scenario(`late outbox enqueue ${outcome} cannot overwrite a newer dispatch`, async () => {
      const context = await makeEvent('pending');
      const entered = deferred();
      const release = deferred();
      const old = relay(a, { ...noQueue, enqueueOutboxEvent: async () => {
        assert.equal(a.isTransactionActive, false); entered.resolve(); return release.promise;
      } }).relayAvailable();
      void old.catch(() => undefined);
      await bounded(entered.promise);
      assert.equal(await relay(b, noQueue, recoveredAt).relayAvailable(), 1);
      const current = await snapshot(context);
      assert.equal(current.event.status, 'dispatched');
      assert.equal(current.event.attempt_count, 2);
      if (outcome === 'success') release.resolve(); else release.reject(new Error('old queue error'));
      await bounded(old);
      assert.deepEqual(await snapshot(context), current);
    });
  }

  await scenario('outbox owner scope and monotonic manual retry fence old finalizers', async () => {
    const context = await makeEvent('pending');
    const owner = ownerOfEvent(await claimEvent(a));
    for (const wrong of [{ workspaceId: randomUUID() }, { eventId: randomUUID() }, { attemptNumber: 2 }]) {
      assert.equal(await finishEvent(b, { ...owner, ...wrong }), false);
    }
    await transaction(a, (manager) => repository.rescheduleOutboxEvent(owner, recoveredAt, 'dead fixture', true, recoveredAt, manager));
    assert.equal(await transaction(b, (manager) => repository.retryDeadOutboxEvent(context.workspace, context.eventId, recoveredAt, manager)), true);
    const next = ownerOfEvent(await claimEvent(b, recoveredAt));
    assert.equal(next.attemptNumber, 2);
    assert.equal(await finishEvent(b, next), true);
    const current = await snapshot(context);
    assert.equal(await transaction(a, (manager) => repository.rescheduleOutboxEvent(owner, recoveredAt, 'late', true, recoveredAt, manager)), false);
    assert.deepEqual(await snapshot(context), current);
  });

  await scenario('late Consumer cannot create deliveries or Audit after reclamation', async () => {
    const context = await makeEndpoint(await makeEvent());
    const entered = deferred();
    const release = deferred();
    let oldNotifications = 0;
    const old = consumer(a, { ...noQueue, enqueueWebhookDelivery: async () => { oldNotifications += 1; } }, audit, startedAt,
      async () => { entered.resolve(); await release.promise; }).consume(context.eventId);
    void old.catch(() => undefined);
    await bounded(entered.promise);
    await consumer(b, noQueue, audit, recoveredAt).consume(context.eventId);
    const current = await snapshot(context);
    assert.equal(current.consumptions[0].attempt_count, 2);
    assert.equal(current.deliveries.length, 1);
    assert.equal(current.logs.length, 1);
    release.resolve();
    assert.deepEqual(await bounded(old), { duplicate: true, effects: 0 });
    assert.equal(oldNotifications, 0);
    assert.deepEqual(await snapshot(context), current);
  });

  await scenario('late Consumer completion and failure cannot change a succeeded receipt', async () => {
    const context = await makeEvent();
    const first = await transaction(a, (manager) => repository.claimEventConsumption(context.eventId, 'atlas.eventing.v1', startedAt, new Date(0), manager));
    const owner = ownerOfConsumption(first, context.workspace);
    await consumer(b, noQueue, audit, recoveredAt).consume(context.eventId);
    const before = await snapshot(context);
    for (const status of ['succeeded', 'failed']) {
      assert.equal(await transaction(a, (manager) => repository.completeEventConsumption(owner, status,
        { processedAt: recoveredAt, errorMessage: 'late', result: { overwritten: true } }, manager)), false);
    }
    assert.deepEqual(await snapshot(context), before);
  });

  await scenario('Consumer effect transaction holds ownership against an actual competing claim', async () => {
    const context = await makeEndpoint(await makeEvent());
    const record = await transaction(a, (manager) => repository.claimEventConsumption(context.eventId, 'atlas.eventing.v1', startedAt, new Date(0), manager));
    const owner = ownerOfConsumption(record, context.workspace);
    await a.startTransaction();
    assert.equal(await repository.lockEventConsumption(owner, a.manager), true);
    const competing = transaction(b, (manager) => repository.claimEventConsumption(context.eventId, 'atlas.eventing.v1', recoveredAt, staleBefore, manager));
    void competing.catch(() => undefined);
    await waitForDatabaseBlock(pidB, pidA);
    assert.equal(await repository.completeEventConsumption(owner, 'succeeded', { processedAt: recoveredAt }, a.manager), true);
    await a.commitTransaction();
    assert.equal(await bounded(competing), undefined);
  });

  await scenario('post-commit queue failure preserves receipt and pending work is rediscovered', async () => {
    const context = await makeEndpoint(await makeEvent());
    let submitted = 0;
    await assert.rejects(consumer(a, { ...noQueue, enqueueWebhookDelivery: async () => {
      assert.equal(a.isTransactionActive, false);
      submitted += 1; throw new Error('queue offline after DB commit');
    } }).consume(context.eventId), /queue offline/u);
    const before = await snapshot(context);
    assert.equal(before.consumptions[0].status, 'succeeded');
    assert.equal(before.deliveries.length, 1);
    assert.equal(before.deliveries[0].status, 'pending');
    assert.equal(before.logs.length, 1);
    const notified = [];
    await relay(b, { ...noQueue, enqueueWebhookDelivery: async (input) => {
      assert.equal(b.isTransactionActive, false); notified.push(input.deliveryId);
    } }, recoveredAt).recoverDueWork();
    assert.ok(notified.includes(before.deliveries[0].id));
    assert.equal(submitted, 1);
    assert.deepEqual(await consumer(a).consume(context.eventId), { duplicate: true, effects: 0 });
    assert.deepEqual(await snapshot(context), before);
  });

  await scenario('Consumer Audit failure rolls back inserted deliveries and success receipt together', async () => {
    const context = await makeEndpoint(await makeEvent());
    const failingAudit = new AuditService({ insert: async (record, manager) => {
      await auditRepository.insert(record, manager);
      if (record.action === 'outbox.event-consumed') throw new Error('injected consumption Audit failure');
    } }, clock);
    await assert.rejects(consumer(a, noQueue, failingAudit).consume(context.eventId), /injected consumption/u);
    const state = await snapshot(context);
    assert.equal(state.deliveries.length, 0);
    assert.equal(state.consumptions[0].status, 'failed');
    assert.equal(state.consumptions[0].result_json, null);
    assert.equal(state.logs.length, 1);
    assert.equal(state.logs[0].action, 'outbox.event-consumption-failed');
  });

  await scenario('Webhook owner fields are independently checked and duplicate finalization is inert', async () => {
    const context = await makeDelivery();
    const owner = ownerOfWebhook(await claimWebhook(a, context.deliveryId));
    const before = await snapshot(context);
    for (const wrong of [{ workspaceId: randomUUID() }, { deliveryId: randomUUID() }, { endpointId: randomUUID() },
      { attemptId: randomUUID() }, { attemptNumber: 2 }]) {
      assert.equal(await finishWebhook(b, { ...owner, ...wrong }), false);
      assert.deepEqual(await snapshot(context), before);
    }
    assert.equal(await finishWebhook(a, owner), true);
    const finished = await snapshot(context);
    assert.equal(await finishWebhook(b, owner, 'dead'), false);
    assert.deepEqual(await snapshot(context), finished);
  });

  for (const outcome of ['success', 'retryable-failure', 'terminal-failure']) {
    await scenario(`late Webhook ${outcome} preserves new Delivery, Attempt, Endpoint and Audit`, async () => {
      const count = outcome === 'terminal-failure' ? 5 : 0;
      const context = await makeDelivery(count);
      const entered = deferred();
      const release = deferred();
      const old = webhook(a, async () => { entered.resolve(); return release.promise; }).deliver(context.deliveryId, count + 1);
      void old.catch(() => undefined);
      await bounded(entered.promise);
      assert.equal(await recoverWebhook(b), 1);
      await webhook(b, undefined, audit, recoveredAt).deliver(context.deliveryId, count + 2);
      const current = await snapshot(context);
      assert.equal(current.deliveries[0].status, 'succeeded');
      assert.equal(current.logs.length, 1);
      assert.equal(current.endpoints[0].consecutive_failure_count, 0);
      if (outcome === 'success') release.resolve({ status: 200 });
      else release.resolve({ status: 503, bodyExcerpt: 'late response' });
      await bounded(old);
      assert.deepEqual(await snapshot(context), current);
    });
  }

  await scenario('late Webhook cannot complete a newly processing attempt', async () => {
    const context = await makeDelivery();
    const old = ownerOfWebhook(await claimWebhook(a, context.deliveryId));
    await recoverWebhook(b);
    const next = ownerOfWebhook(await claimWebhook(b, context.deliveryId, 2, recoveredAt));
    const current = await snapshot(context);
    assert.equal(await finishWebhook(a, old), false);
    assert.deepEqual(await snapshot(context), current);
    assert.equal(await finishWebhook(b, next), true);
  });

  await scenario('new endpoint configuration is not disabled by an old configuration response', async () => {
    const context = await makeDelivery(5);
    const execution = await claimWebhook(a, context.deliveryId, 6);
    await transaction(b, (manager) => repository.updateWebhookEndpoint(context.workspace, context.endpointId, {
      expectedVersion: 1, nextVersion: 2, name: 'Reconfigured', url: `https://hooks.example.com/${context.endpointId}/new`,
      subscribedEvents: ['content.published'], updatedAt: recoveredAt,
    }, manager));
    assert.equal(await finishWebhook(a, ownerOfWebhook(execution), 'dead'), true);
    const current = await snapshot(context);
    assert.equal(current.deliveries[0].status, 'dead');
    assert.equal(current.endpoints[0].status, 'active');
    assert.equal(current.endpoints[0].consecutive_failure_count, 1);
    assert.equal(current.endpoints[0].version, 2);
  });

  await scenario('only a current terminal Webhook result changes the Endpoint failure policy once', async () => {
    const context = await makeDelivery(5);
    await webhook(a, async () => ({ status: 503 })).deliver(context.deliveryId, 6);
    const before = await snapshot(context);
    assert.equal(before.deliveries[0].status, 'dead');
    assert.equal(before.endpoints[0].consecutive_failure_count, 2);
    assert.equal(before.endpoints[0].status, 'disabled');
    assert.equal(before.logs.length, 1);
    await webhook(b).deliver(context.deliveryId, 6);
    assert.deepEqual(await snapshot(context), before);
  });

  await scenario('Webhook recovery skips locked finalization and never broadly updates skipped rows', async () => {
    const context = await makeDelivery();
    const owner = ownerOfWebhook(await claimWebhook(a, context.deliveryId));
    await a.startTransaction();
    assert.equal(await repository.finishWebhookDeliveryExecution(owner, {
      status: 'succeeded', finishedAt: recoveredAt, endpointFailureThreshold: 2,
    }, a.manager), true);
    assert.equal(await recoverWebhook(b), 0);
    await a.commitTransaction();
    const state = await snapshot(context);
    assert.equal(state.deliveries[0].status, 'succeeded');
    assert.equal(state.attempts[0].status, 'succeeded');
  });

  await scenario('Webhook finalization waiting for recovery rechecks ownership after the actual lock wait', async () => {
    const context = await makeDelivery();
    const owner = ownerOfWebhook(await claimWebhook(a, context.deliveryId));
    await a.startTransaction();
    assert.equal(await repository.recoverStaleWebhookDeliveries(staleBefore, recoveredAt, a.manager), 1);
    const oldCompletion = finishWebhook(b, owner);
    void oldCompletion.catch(() => undefined);
    await waitForDatabaseBlock(pidB, pidA);
    await a.commitTransaction();
    assert.equal(await bounded(oldCompletion), false);
    const next = ownerOfWebhook(await claimWebhook(b, context.deliveryId, 2, recoveredAt));
    assert.equal(await finishWebhook(b, next), true);
  });

  await scenario('Webhook retries respect persisted due time and manual retry never resets attempt count', async () => {
    const context = await makeDelivery();
    const old = ownerOfWebhook(await claimWebhook(a, context.deliveryId));
    assert.equal(await finishWebhook(a, old, 'retry_scheduled'), true);
    assert.equal(await claimWebhook(b, context.deliveryId, 2, recoveredAt), undefined);
    assert.equal(await transaction(b, (manager) => repository.resetWebhookDeliveryForRetry(context.workspace, context.deliveryId, recoveredAt, manager)), true);
    const next = ownerOfWebhook(await claimWebhook(b, context.deliveryId, 2, recoveredAt));
    assert.equal(next.attemptNumber, 2);
    assert.equal(await finishWebhook(b, next), true);
    const finished = await snapshot(context);
    assert.equal(await finishWebhook(a, old, 'dead'), false);
    assert.deepEqual(await snapshot(context), finished);
  });

  await scenario('Webhook Audit persistence failure rolls back the whole result and is not an HTTP retry', async () => {
    const context = await makeDelivery();
    const failingAudit = new AuditService({ insert: async (record, manager) => {
      await auditRepository.insert(record, manager); throw new Error('injected Webhook Audit failure');
    } }, clock);
    await assert.rejects(webhook(a, undefined, failingAudit).deliver(context.deliveryId, 1), /injected Webhook/u);
    const failed = await snapshot(context);
    assert.equal(failed.deliveries[0].status, 'processing');
    assert.equal(failed.attempts[0].status, 'processing');
    assert.equal(failed.endpoints[0].consecutive_failure_count, 1);
    assert.equal(failed.logs.length, 0);
    await recoverWebhook(b);
    await webhook(b, undefined, audit, recoveredAt).deliver(context.deliveryId, 2);
  });

  await scenario('all Eventing ownership mutation entry points reject an autocommit manager', async () => {
    const context = await makeDelivery();
    const eventOwner = { eventId: context.eventId, workspaceId: context.workspace, attemptNumber: 1 };
    await assert.rejects(repository.claimAvailableOutboxEvents(startedAt, staleBefore, 1, a.manager), /active transaction/u);
    await assert.rejects(repository.markOutboxEventDispatched(eventOwner, recoveredAt, a.manager), /active transaction/u);
    await assert.rejects(repository.rescheduleOutboxEvent(eventOwner, recoveredAt, 'late', false, recoveredAt, a.manager), /active transaction/u);
    await assert.rejects(repository.claimEventConsumption(context.eventId, 'c', startedAt, staleBefore, a.manager), /active transaction/u);
    await assert.rejects(repository.startWebhookDeliveryAttempt(context.deliveryId, { id: randomUUID(), attemptNumber: 1, requestedAt: startedAt }, a.manager), /active transaction/u);
    await assert.rejects(repository.recoverStaleWebhookDeliveries(staleBefore, recoveredAt, a.manager), /active transaction/u);
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
