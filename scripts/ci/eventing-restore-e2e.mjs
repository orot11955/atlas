import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE = 'atlas_eventing_preflight_test';
const DESTINATION = 'atlas_eventing_restore_test';
const identifier = (name) => {
  assert.match(name, /^[a-z][a-z0-9_]*$/u, 'Unexpected test schema identifier.');
  return `public."${name}"`;
};

export function validateRestoreEnvironment(environment, args = []) {
  assert.equal(args.length, 0, 'This CI rehearsal accepts no operational arguments.');
  assert.equal(environment.NODE_ENV, 'test');
  assert.equal(environment.ATLAS_ALLOW_EVENTING_RESTORE_TESTS, '1');
  const source = new URL(environment.ATLAS_EVENTING_RESTORE_SOURCE_URL ?? '');
  assert.ok(['postgres:', 'postgresql:'].includes(source.protocol));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname));
  assert.equal(source.pathname, `/${SOURCE}`);
  assert.equal(source.username, 'atlas');
  assert.equal(source.port, '5432');
  assert.equal(source.search + source.hash, '');
  assert.match(environment.ATLAS_EVENTING_TEST_POSTGRES_CONTAINER ?? '', /^[a-f0-9]{64}$/u);
  const destination = new URL(source);
  destination.pathname = `/${DESTINATION}`;
  return { source, destination, container: environment.ATLAS_EVENTING_TEST_POSTGRES_CONTAINER };
}

export function postgresArguments(container, operation) {
  assert.match(container, /^[a-f0-9]{64}$/u);
  const prefix = ['exec', '-i', '--env', 'PGCONNECT_TIMEOUT=5', '--env',
    'PGOPTIONS=-c lock_timeout=1000 -c statement_timeout=10000', container];
  const connection = ['--host=/var/run/postgresql', '--username=atlas', '--no-password'];
  if (operation === 'dump') {
    return [...prefix, 'pg_dump', ...connection, `--dbname=${SOURCE}`, '--format=custom',
      '--lock-wait-timeout=1000'];
  }
  if (operation === 'restore') {
    return [...prefix, 'pg_restore', ...connection, `--dbname=${DESTINATION}`,
      '--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges'];
  }
  if (operation === 'identity') {
    return [...prefix, 'psql', ...connection, `--dbname=${SOURCE}`, '--no-psqlrc',
      '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1',
      '--command=SELECT id::text FROM public.workspaces ORDER BY id'];
  }
  throw new Error('Unsupported PostgreSQL test operation.');
}

export async function assertEmptyRestoreTarget(database) {
  const [{ name }] = await database.query('SELECT current_database() AS name');
  assert.equal(name, DESTINATION, 'Only the fixed disposable destination can be restored.');
  const [{ count }] = await database.query(`SELECT count(*)::int AS count FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema')
    AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'`);
  assert.equal(count, 0, 'Refusing a populated restore destination; never clean or overwrite it.');
}

async function snapshot(database) {
  const tables = await database.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'
    ORDER BY tablename COLLATE "C"`);
  const state = { tables: {}, sequences: {}, constraints: [], triggers: [], indexes: [] };
  for (const { tablename } of tables) {
    const rows = await database.query(`SELECT to_jsonb(t)::text AS value FROM ${identifier(tablename)} t
      ORDER BY to_jsonb(t)::text COLLATE "C"`);
    const hash = createHash('sha256');
    for (const { value } of rows) hash.update(value).update('\n');
    state.tables[tablename] = { rows: rows.length, sha256: hash.digest('hex') };
  }
  for (const { sequencename } of await database.query(`SELECT sequencename FROM pg_sequences
    WHERE schemaname='public' ORDER BY sequencename COLLATE "C"`)) {
    state.sequences[sequencename] = await database.query(
      `SELECT last_value::text, is_called FROM ${identifier(sequencename)}`,
    );
  }
  state.constraints = await database.query(`SELECT c.conrelid::regclass::text AS relation,
    c.conname, c.contype, c.convalidated, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
    WHERE n.nspname='public' ORDER BY c.conrelid::regclass::text COLLATE "C", c.conname COLLATE "C"`);
  state.triggers = await database.query(`SELECT c.relname, t.tgname, t.tgenabled,
    pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
    ORDER BY c.relname COLLATE "C", t.tgname COLLATE "C"`);
  state.indexes = await database.query(`SELECT tablename,indexname,indexdef FROM pg_indexes
    WHERE schemaname='public' ORDER BY tablename COLLATE "C",indexname COLLATE "C"`);
  return state;
}

function services(database, server, clock) {
  const runner = { run: (work) => database.transaction(work) };
  const repository = new server.TypeOrmEventingRepository(database);
  const audit = new server.AuditService(new server.TypeOrmAuditRepository(database), clock);
  const outbox = new server.OutboxService(repository, clock);
  const publications = new server.TypeOrmContentPublicationRepository(database);
  const assets = new server.TypeOrmContentAssetRepository(database);
  const commands = new server.ScheduledPublicationCommandService(
    runner, repository, new server.TypeOrmPublicationScheduleEffectRepository(), publications,
    (transaction) => new server.ContentPublicationService(
      { run: (work) => work(transaction) }, publications, audit, assets,
      { buildPublicUrl: () => { throw new Error('No media fixture is allowed.'); } }, clock, outbox,
    ), clock,
  );
  const notifications = [];
  const queue = {
    enqueueOutboxEvent: async (input) => { notifications.push(input.eventId); },
    enqueueWebhookDelivery: async () => { throw new Error('No external delivery is allowed.'); },
    enqueuePublicationSchedule: async () => { throw new Error('No queue scheduling is allowed.'); },
  };
  return {
    repository, notifications,
    scheduling: new server.PublicationSchedulingService(runner, repository, audit, outbox, clock),
    processor: new server.PublicationScheduleProcessor(runner, repository, commands, audit, clock),
    consumer: new server.OutboxConsumerService(runner, repository, queue, audit,
      { staleMilliseconds: 30_000 }, clock),
    relay: new server.OutboxRelayService(runner, repository, queue, {
      outboxBatchSize: 50, outboxStaleMilliseconds: 30_000, webhookBatchSize: 50,
      webhookStaleMilliseconds: 30_000, publicationBatchSize: 50,
      publicationStaleMilliseconds: 30_000, maximumAttempts: 5,
    }, clock),
  };
}

async function completedFixture(database, server, at) {
  const c = Object.fromEntries(['workspace', 'site', 'content', 'assignment', 'revision', 'endpoint']
    .map((key) => [key, server.createUuidV7()]));
  const [admin] = await database.query('SELECT id FROM admin_accounts ORDER BY id LIMIT 1');
  assert.ok(admin, 'Run the existing Preflight fixture suite first.');
  await database.transaction(async (tx) => {
    await tx.query(`INSERT INTO workspaces(id,key,name,timezone,locale,created_at,updated_at)
      VALUES($1,$2,'Restore fixture','UTC','en',$3,$3)`, [c.workspace, `w-${c.workspace}`, at]);
    await tx.query(`INSERT INTO sites(id,workspace_id,key,name,type,status,timezone,locale,created_at,updated_at)
      VALUES($1,$2,$3,'Restore fixture','blog','active','UTC','en',$4,$4)`,
    [c.site, c.workspace, `s-${c.site}`, at]);
    await tx.query(`INSERT INTO contents(id,workspace_id,type,status,created_by_admin_account_id,created_at,updated_at)
      VALUES($1,$2,'post','draft',$3,$4,$4)`, [c.content, c.workspace, admin.id, at]);
    await tx.query(`INSERT INTO content_drafts(content_id,workspace_id,title,body_markdown,updated_by_admin_account_id,updated_at)
      VALUES($1,$2,'Restore fixture','Body',$3,$4)`, [c.content, c.workspace, admin.id, at]);
    await tx.query(`INSERT INTO content_sites(id,workspace_id,content_id,site_id,slug,created_at,updated_at)
      VALUES($1,$2,$3,$4,'restore-fixture',$5,$5)`, [c.assignment, c.workspace, c.content, c.site, at]);
    await tx.query(`INSERT INTO content_revisions(id,content_id,workspace_id,revision_number,kind,title,
      body_markdown,body_html,source_draft_version,created_by_admin_account_id,created_at)
      VALUES($1,$2,$3,1,'ready','Restore fixture','Body','<p>Body</p>',1,$4,$5)`,
    [c.revision, c.content, c.workspace, admin.id, at]);
    await tx.query(`UPDATE contents SET status='ready',current_revision_number=1,ready_revision_number=1 WHERE id=$1`,
      [c.content]);
  });
  const initial = services(database, server, new server.FixedClock(at));
  const due = new Date(at.getTime() + 60_000);
  c.schedule = await server.requestContext.run({ requestId: server.createUuidV7(),
    traceId: server.createUuidV7(), actorType: server.ActorType.ADMIN, actorId: admin.id,
    workspaceId: c.workspace, siteId: c.site }, () => initial.scheduling.create(
    c.workspace, c.content, c.assignment, { action: 'publish', timezone: 'UTC',
      scheduledLocalAt: due.toISOString().slice(0, 19) },
  ));
  const live = services(database, server, new server.FixedClock(due));
  await live.processor.process(c.schedule.id, 1);
  const [publication] = await database.query(`SELECT id,revision_id FROM content_publications
    WHERE content_site_id=$1 AND status='active'`, [c.assignment]);
  assert.equal(publication.revision_id, c.revision);
  const [event] = await database.query(`SELECT id FROM outbox_events WHERE workspace_id=$1
    AND event_type='content.published' AND aggregate_id=$2`, [c.workspace, publication.id]);
  assert.ok(event);
  await live.relay.relayAvailable();
  assert.ok(live.notifications.includes(event.id));
  assert.equal((await live.consumer.consume(event.id)).duplicate, false);
  c.event = event.id;
  c.due = due;
  // This key exists only in test memory. No environment/Compose keyring is modified.
  c.key = randomBytes(32).toString('base64');
  c.secret = randomBytes(48).toString('base64url');
  const encrypted = new server.Aes256GcmWebhookSecretCipher(c.key, 'restore-fixture-v1').encrypt(c.secret);
  await database.transaction((tx) => live.repository.insertWebhookEndpoint({
    id: c.endpoint, workspaceId: c.workspace, siteId: c.site, name: 'Restore key fixture',
    url: 'https://hooks.example.test', status: 'disabled',
    secretCiphertext: encrypted.encryptedValue, secretKeyVersion: encrypted.keyVersion,
    subscribedEvents: ['content.published'], consecutiveFailureCount: 0, version: 1,
    createdByAdminAccountId: admin.id, createdAt: at, updatedAt: at,
  }, tx));
  return c;
}

export async function runRestoreRehearsal(environment = process.env, args = []) {
  const input = validateRestoreEnvironment(environment, args);
  const { collectEventingPreflight } = await import('../operations/eventing-rollout-preflight.mjs');
  const prerequisite = JSON.parse(readFileSync('tmp/r05g-preflight/result.json', 'utf8'));
  assert.equal(prerequisite.result, 'success');
  assert.equal(prerequisite.checkoutSha, environment.GITHUB_SHA ?? null);
  const require = createRequire(resolve('packages/database/package.json'));
  const { DataSource } = require('typeorm');
  const server = require('@atlas/server');
  const { atlasDataSource } = require(resolve('packages/database/dist/data-source.js'));
  const connect = (url) => new DataSource({ ...atlasDataSource.options, url: url.href,
    synchronize: false, migrationsRun: false, logging: false,
    extra: { options: '-c timezone=UTC -c lock_timeout=1000 -c statement_timeout=10000' } });
  const source = connect(input.source);
  const destination = connect(input.destination);
  const passed = [];
  const scenario = async (name, work) => {
    console.log(`# ${name}`);
    await work(); passed.push(name); console.log(`ok ${passed.length} - ${name}`);
  };
  const command = (operation, stdin = 'ignore', stdout = 'pipe') => {
    const result = spawnSync('docker', postgresArguments(input.container, operation), {
      stdio: [stdin, stdout, 'pipe'], timeout: 30_000, maxBuffer: 2_000_000,
    });
    assert.ok(result.status === 0 && !result.error, `PostgreSQL ${operation} failed; raw diagnostics withheld.`);
    assert.equal(result.stderr?.length ?? 0, 0, `PostgreSQL ${operation} emitted diagnostics.`);
    return result.stdout;
  };
  let temporary;
  let archive;
  let baseline;
  let sourceAfterBackup;
  try {
    await source.initialize();
    assert.equal(await source.showMigrations(), false);
    const [{ count: applied }] = await source.query('SELECT count(*)::int AS count FROM atlas_migrations');
    assert.equal(applied, prerequisite.migrations);
    assert.equal((await source.query('SELECT 1 FROM pg_database WHERE datname=$1', [DESTINATION])).length, 0,
      'Destination database already exists; never drop or overwrite it.');
    const expectedIdentity = (await source.query('SELECT id::text FROM workspaces ORDER BY id'))
      .map((row) => row.id).join('\n');
    assert.equal(command('identity').toString('utf8').trim(), expectedIdentity,
      'Docker service and loopback source do not identify the same fixture.');
    const fixture = await completedFixture(source, server, new Date('2030-01-01T00:00:00Z'));
    await scenario('source contains nonempty historical data and real completed effect and consumer receipts', async () => {
      baseline = await snapshot(source);
      for (const name of ['atlas_migrations', 'publication_schedules', 'publication_schedule_effects',
        'content_revisions', 'content_publications', 'event_consumptions', 'event_consumption_attempts',
        'webhook_endpoints', 'webhook_deliveries', 'webhook_delivery_attempts', 'outbox_events', 'audit_logs']) {
        assert.ok(baseline.tables[name]?.rows > 0, `${name}: empty coverage is not accepted.`);
      }
      const [{ count }] = await source.query(`SELECT count(*)::int AS count FROM publication_schedules
        WHERE revision_id IS NULL AND revision_number IS NULL AND target_publication_id IS NULL`);
      assert.equal(count, 2);
    });
    temporary = mkdtempSync(join(tmpdir(), 'atlas-r05h-'));
    archive = join(temporary, 'fixture.dump');
    await scenario('custom-format pg_dump preserves the source and keeps the archive private', async () => {
      const fd = openSync(archive, 'wx', 0o600);
      try { command('dump', 'ignore', fd); } finally { closeSync(fd); }
      assert.equal(statSync(temporary).mode & 0o777, 0o700);
      assert.equal(statSync(archive).mode & 0o777, 0o600);
      assert.equal(readFileSync(archive).subarray(0, 5).toString(), 'PGDMP');
      assert.deepEqual(await snapshot(source), baseline);
    });
    // A deliberate later fixture event demonstrates the backup's point-in-time limit.
    const lateId = server.createUuidV7();
    const repo = new server.TypeOrmEventingRepository(source);
    const original = await repo.findOutboxEvent(fixture.event);
    await source.transaction((tx) => repo.insertOutboxEvent({ ...original, id: lateId,
      payload: { ...original.payload, eventId: lateId }, status: 'pending', attemptCount: 0,
      dispatchedAt: undefined, createdAt: new Date(fixture.due.getTime() + 60_000),
      updatedAt: new Date(fixture.due.getTime() + 60_000),
    }, tx));
    sourceAfterBackup = await snapshot(source);
    await source.query(`CREATE DATABASE ${DESTINATION} TEMPLATE template0`);
    await destination.initialize();
    await scenario('full restore into an empty database preserves every public table, sequence, index, constraint and trigger', async () => {
      await assertEmptyRestoreTarget(destination);
      const fd = openSync(archive, 'r');
      try { command('restore', fd); } finally { closeSync(fd); }
      assert.deepEqual(await snapshot(destination), baseline);
      assert.deepEqual(await snapshot(source), sourceAfterBackup);
      assert.equal(await destination.showMigrations(), false);
    });
    await scenario('a populated restore target is refused rather than cleaned or overwritten', async () => {
      await assert.rejects(assertEmptyRestoreTarget(destination), /populated restore destination/u);
      assert.deepEqual(await snapshot(destination), baseline);
    });
    await scenario('restored success receipts prevent duplicate schedule effects and consumer execution', async () => {
      const restored = services(destination, server, new server.FixedClock(fixture.due));
      await restored.processor.process(fixture.schedule.id, 1);
      assert.deepEqual(await restored.consumer.consume(fixture.event), { duplicate: true, effects: 0 });
      assert.equal(restored.notifications.length, 0);
      assert.deepEqual(await snapshot(destination), baseline);
    });
    await scenario('restored target-required trigger and diagnostic constraints remain enforced', async () => {
      const [trigger] = await destination.query(`SELECT tgenabled FROM pg_trigger
        WHERE tgname='trg_require_new_publication_schedule_target'`);
      assert.equal(trigger.tgenabled, 'O');
      await assert.rejects(destination.transaction((tx) => tx.query(`INSERT INTO publication_schedules
        (id,workspace_id,site_id,content_id,content_site_id,action,scheduled_for,timezone,
        scheduled_local_at,requested_by_admin_account_id,created_at,updated_at,next_attempt_at)
        SELECT $1,workspace_id,site_id,content_id,content_site_id,action,scheduled_for,timezone,
        scheduled_local_at,requested_by_admin_account_id,created_at,updated_at,next_attempt_at
        FROM publication_schedules WHERE id=$2`, [server.createUuidV7(), fixture.schedule.id])),
      (error) => (error.driverError?.code ?? error.code) === '23514' && /pinned target/u.test(error.message));
      await assert.rejects(destination.transaction((tx) => tx.query(
        "UPDATE webhook_deliveries SET last_response_excerpt='restore-invalid-diagnostic-fixture'",
      )), (error) => (error.driverError?.code ?? error.code) === '23514');
      assert.deepEqual(await snapshot(destination), baseline);
    });
    await scenario('a fresh cipher decrypts restored ciphertext only with the retained historical test key', async () => {
      const [endpoint] = await destination.query('SELECT secret_ciphertext,secret_key_version FROM webhook_endpoints WHERE id=$1',
        [fixture.endpoint]);
      const retained = new server.Aes256GcmWebhookSecretCipher(fixture.key, 'restore-fixture-v1');
      assert.ok(retained.decrypt(endpoint.secret_ciphertext, endpoint.secret_key_version) === fixture.secret);
      const missing = new server.Aes256GcmWebhookSecretCipher(randomBytes(32).toString('base64'), 'restore-fixture-v2');
      assert.throws(() => missing.decrypt(endpoint.secret_ciphertext, endpoint.secret_key_version), /version is not available/u);
      const wrong = new server.Aes256GcmWebhookSecretCipher(randomBytes(32).toString('base64'), 'restore-fixture-v1');
      assert.throws(() => wrong.decrypt(endpoint.secret_ciphertext, endpoint.secret_key_version), /authentication failed/u);
      assert.deepEqual(await snapshot(destination), baseline);
    });
    await scenario('restored preflight remains inventory-only and the later source event is absent from the backup', async () => {
      const reader = destination.createQueryRunner();
      await reader.connect();
      try {
        const legacy = await destination.query(`SELECT workspace_id FROM publication_schedules
          WHERE revision_id IS NULL AND revision_number IS NULL AND target_publication_id IS NULL`);
        for (const row of legacy) {
          const report = await collectEventingPreflight(reader, row.workspace_id);
          assert.equal(report.schedules.missing_target, '1');
          assert.equal(report.diagnosticPolicyApplied, true);
          assert.equal(report.deploymentAuthorized, false);
          assert.equal(report.keyRetirementAuthorized, false);
          for (const counts of Object.values(report.diagnostics)) assert.equal(counts.rewrite_candidates, '0');
        }
      } finally { await reader.release(); }
      assert.equal((await source.query('SELECT id FROM outbox_events WHERE id=$1', [lateId])).length, 1);
      assert.equal((await destination.query('SELECT id FROM outbox_events WHERE id=$1', [lateId])).length, 0);
      assert.deepEqual(await snapshot(source), sourceAfterBackup);
      assert.deepEqual(await snapshot(destination), baseline);
    });
    assert.equal(passed.length, 8);
    const result = { result: 'success', scenarios: passed.length, passed,
      checkoutSha: environment.GITHUB_SHA ?? null, migrations: applied,
      tablesCompared: Object.keys(baseline.tables).length,
      nonemptyTables: Object.values(baseline.tables).filter((table) => table.rows > 0).length,
      sequencesCompared: Object.keys(baseline.sequences).length,
      constraintsCompared: baseline.constraints.length, triggersCompared: baseline.triggers.length,
      indexesCompared: baseline.indexes.length,
      archiveBytes: statSync(archive).size,
      archiveSha256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
      scope: 'synthetic-isolated-postgresql-logical-restore', productionChanges: false,
      redisWorkerOrExternalHttp: false, operationalBackupVerified: false,
      deploymentAuthorized: false, keyRetirementAuthorized: false, archivePublished: false };
    writeFileSync('tmp/r05g-preflight/restore-result.json', JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally {
    try {
      if (destination.isInitialized) await destination.destroy();
    } finally {
      try {
        if (source.isInitialized) await source.destroy();
      } finally {
        if (temporary) rmSync(temporary, { recursive: true, force: true });
      }
    }
    // No DROP, clean, trigger disabling, production key operation or diagnostic dump upload.
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runRestoreRehearsal(process.env, process.argv.slice(2)).catch((error) => {
    const code = error.driverError?.code ?? error.code;
    const safeCode = typeof code === 'string' && /^(?:[0-9A-Z]{5}|ERR_ASSERTION)$/u.test(code) ? code : 'unclassified';
    console.error(`Eventing restore rehearsal failed (${safeCode}); raw SQL, rows, keys and client diagnostics are withheld.`);
    process.exitCode = 1;
  });
}
