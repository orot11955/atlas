import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const POLICY = 'EnforceWebhookDiagnosticPolicy1788696000000';
const TABLES = ['webhook_deliveries', 'webhook_delivery_attempts'];
const FIELDS = {
  webhook_deliveries: ['last_response_excerpt', 'last_error'],
  webhook_delivery_attempts: ['response_body_excerpt', 'error_message'],
};
const BODY = '[response body omitted by policy]';
const ERROR = 'Webhook diagnostic: processing-failed.';
const quote = (name) => {
  assert.match(name, /^[a-z][a-z0-9_]*$/u);
  return `public."${name}"`;
};
const codeOf = (error) => error?.driverError?.code ?? error?.code;

export function validateDiagnosticRehearsal(database, environment) {
  assert.equal(environment.NODE_ENV, 'test');
  assert.equal(environment.ATLAS_ALLOW_DIAGNOSTIC_MIGRATION_TESTS, '1');
  const url = new URL(database.options.url);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.pathname, '/atlas_eventing_preflight_test');
  assert.equal(url.search + url.hash, '');
  assert.ok([undefined, 'public'].includes(database.options.schema));
  assert.equal(database.options.synchronize, false);
  assert.equal(database.options.migrationsRun, false);
  assert.equal(database.options.logging, false);
  assert.equal(database.options.migrationsTableName, 'atlas_migrations');
  assert.equal(database.isInitialized, true);
}

export function requireOnlyDiagnosticMigration(pending) {
  assert.deepEqual(
    pending.map((migration) => migration.name),
    [POLICY],
  );
  assert.notEqual(pending[0].instance?.transaction, false);
}

async function inventory(connection) {
  const tables = {};
  for (const { tablename } of await connection.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  )) {
    const rows =
      await connection.query(`SELECT to_jsonb(t)::text AS value FROM ${quote(tablename)} t
      ORDER BY to_jsonb(t)::text COLLATE "C"`);
    const digest = createHash('sha256');
    for (const { value } of rows) digest.update(value).update('\n');
    tables[tablename] = { count: rows.length, sha256: digest.digest('hex') };
  }
  const constraints = await connection.query(`SELECT c.conrelid::regclass::text AS relation,
    c.conname,c.convalidated,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
    JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'
    ORDER BY c.conrelid::regclass::text,c.conname`);
  const triggers = await connection.query(`SELECT c.relname,t.tgname,t.tgenabled,
    pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
    ORDER BY c.relname,t.tgname`);
  return { tables, constraints, triggers };
}

async function diagnostics(connection) {
  const rows = {};
  for (const table of TABLES)
    rows[table] = await connection.query(`SELECT * FROM ${quote(table)} ORDER BY id`);
  return rows;
}

function nonPolicyTables(state) {
  return Object.fromEntries(
    Object.entries(state.tables).filter(
      ([name]) => ![...TABLES, 'atlas_migrations'].includes(name),
    ),
  );
}

async function rehearse(database, environment) {
  validateDiagnosticRehearsal(database, environment);
  const require = createRequire(resolve('packages/database/package.json'));
  const { MigrationExecutor } = require('typeorm');
  const connections = [
    database.createQueryRunner(),
    database.createQueryRunner(),
    database.createQueryRunner(),
  ];
  const [observer, migrator, oldSession] = connections;
  const passed = [];
  const locksObserved = [];
  const scenario = async (name, work) => {
    console.log(`# diagnostic-migration: ${name}`);
    await work();
    passed.push(name);
    console.log(`ok diagnostic-migration ${passed.length} - ${name}`);
  };
  const executor = () => {
    const execution = new MigrationExecutor(database, migrator);
    execution.transaction = 'all'; // Match the actual repository migration-cli.ts.
    return execution;
  };
  const applied = () => observer.query('SELECT * FROM public.atlas_migrations ORDER BY id');
  const fingerprints = async () => {
    const result = {};
    for (const table of TABLES)
      result[table] = await observer.query(
        `SELECT id,xmin::text AS xmin FROM ${quote(table)} ORDER BY id`,
      );
    return result;
  };
  const policyChecks = (state) =>
    state.constraints.filter((row) =>
      TABLES.some((table) =>
        [`chk_${table}_safe_response`, `chk_${table}_safe_error`].includes(row.conname),
      ),
    );
  try {
    await Promise.all(connections.map((connection) => connection.connect()));
    for (const connection of connections) {
      await connection.query("SET lock_timeout = '1000ms'");
      await connection.query("SET statement_timeout = '5000ms'");
      await connection.query("SET idle_in_transaction_session_timeout = '10000ms'");
    }
    const identities = await Promise.all(
      connections.map(async (connection) => {
        const [row] = await connection.query(
          'SELECT current_database() AS name,pg_backend_pid() AS pid',
        );
        assert.equal(row.name, 'atlas_eventing_preflight_test');
        return row.pid;
      }),
    );
    assert.equal(new Set(identities).size, 3);
    const [, migrationPid, oldPid] = identities;
    requireOnlyDiagnosticMigration(await executor().getPendingMigrations());
    const original = await inventory(observer);
    const originalRows = await diagnostics(observer);
    const originalHistory = await applied();
    assert.equal(policyChecks(original).length, 0);
    for (const table of TABLES) {
      assert.equal(originalRows[table].length, 2, 'Both legacy Workspace fixtures are mandatory.');
      for (const row of originalRows[table])
        for (const field of FIELDS[table]) {
          assert.equal(row[field], 'preflight-private-diagnostic-sentinel');
        }
    }
    const [{ count: targetless }] = await observer.query(`SELECT count(*)::int AS count
      FROM publication_schedules WHERE revision_id IS NULL AND revision_number IS NULL
      AND target_publication_id IS NULL`);
    assert.equal(targetless, 2);

    async function contention(table, phase) {
      await oldSession.startTransaction();
      // A real SELECT acquires ACCESS SHARE; no synthetic failure or forced table lock.
      await oldSession.query(`SELECT id FROM ${quote(table)} LIMIT 1`);
      let finished = false;
      const pending = executor()
        .executePendingMigrations()
        .then(
          () => ({ code: 'unexpected-success' }),
          (error) => ({ code: codeOf(error) }),
        )
        .finally(() => {
          finished = true;
        });
      let evidence;
      try {
        const deadline = Date.now() + 4000;
        while (!finished && Date.now() < deadline) {
          const [{ blockers }] = await observer.query('SELECT pg_blocking_pids($1) AS blockers', [
            migrationPid,
          ]);
          if (blockers.includes(oldPid)) {
            const locks = await observer.query(
              `SELECT c.relname,l.mode,l.granted FROM pg_locks l
              JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE l.pid=$1 AND n.nspname='public' AND c.relname=ANY($2::text[])`,
              [migrationPid, TABLES],
            );
            if (
              locks.some(
                (lock) =>
                  lock.relname === table && lock.mode === 'AccessExclusiveLock' && !lock.granted,
              )
            ) {
              evidence = {
                phase,
                blockedTable: table,
                blockerObserved: true,
                firstTableExclusiveHeld: locks.some(
                  (lock) =>
                    lock.relname === TABLES[0] &&
                    lock.mode === 'AccessExclusiveLock' &&
                    lock.granted,
                ),
              };
              break;
            }
          }
          await delay(10);
        }
        assert.ok(evidence, 'The actual PostgreSQL lock wait must be observed.');
        assert.equal(evidence.firstTableExclusiveHeld, phase === 'second-table');
        assert.equal((await pending).code, '55P03');
        assert.equal(migrator.isTransactionActive, false);
        locksObserved.push(evidence);
      } finally {
        if (oldSession.isTransactionActive) await oldSession.rollbackTransaction();
        await pending;
      }
      assert.deepEqual(await inventory(observer), original);
      assert.deepEqual(await diagnostics(observer), originalRows);
      assert.deepEqual(await applied(), originalHistory);
      requireOnlyDiagnosticMigration(await executor().getPendingMigrations());
    }

    await scenario('first-table reader blocks DDL and all changes roll back', () =>
      contention(TABLES[0], 'first-table'),
    );
    await scenario(
      'second-table reader rolls back prior cleanup, first-table DDL and migration history',
      () => contention(TABLES[1], 'second-table'),
    );

    // A session/transaction opened before migration is not an actual old Worker.
    await oldSession.startTransaction();
    await oldSession.query('SELECT 1');
    let sanitized;
    let sanitizedRows;
    await scenario(
      'unblocked real migration changes only diagnostic fields and records one application',
      async () => {
        const executed = await executor().executePendingMigrations();
        assert.deepEqual(
          executed.map((migration) => migration.name),
          [POLICY],
        );
        assert.equal(migrator.isTransactionActive, false);
        sanitized = await inventory(observer);
        sanitizedRows = await diagnostics(observer);
        for (const table of TABLES) {
          const [body, error] = FIELDS[table];
          assert.deepEqual(
            sanitizedRows[table],
            originalRows[table].map((row) => ({
              ...row,
              [body]: BODY,
              [error]: ERROR,
            })),
          );
        }
        assert.deepEqual(nonPolicyTables(sanitized), nonPolicyTables(original));
        assert.deepEqual(sanitized.triggers, original.triggers);
        const checks = policyChecks(sanitized);
        assert.equal(checks.length, 4);
        assert.ok(checks.every((row) => row.convalidated === true));
        assert.deepEqual(
          sanitized.constraints.filter((row) => !checks.includes(row)),
          original.constraints,
        );
        const history = await applied();
        assert.deepEqual(
          history.filter((row) => row.name !== POLICY),
          originalHistory,
        );
        assert.equal(history.filter((row) => row.name === POLICY).length, 1);
        assert.equal(history.length, originalHistory.length + 1);
        assert.deepEqual(await executor().getPendingMigrations(), []);
      },
    );

    await scenario(
      'old SQL session cannot persist raw diagnostics after policy commit',
      async () => {
        for (const table of TABLES)
          for (const field of FIELDS[table]) {
            if (!oldSession.isTransactionActive) await oldSession.startTransaction();
            try {
              await assert.rejects(
                oldSession.query(`UPDATE ${quote(table)} SET "${field}"=$1 WHERE id=$2`, [
                  'preflight-private-diagnostic-sentinel',
                  originalRows[table][0].id,
                ]),
                (error) =>
                  codeOf(error) === '23514' &&
                  error.driverError?.constraint ===
                    `chk_${table}_safe_${field === FIELDS[table][0] ? 'response' : 'error'}`,
              );
            } finally {
              await oldSession.rollbackTransaction();
            }
          }
        assert.deepEqual(await inventory(observer), sanitized);
        assert.deepEqual(await diagnostics(observer), sanitizedRows);
      },
    );

    await scenario(
      'real down removes only policy checks and cannot resurrect discarded diagnostics',
      async () => {
        const beforeXmin = await fingerprints();
        await executor().undoLastMigration();
        const reverted = await inventory(observer);
        assert.deepEqual(reverted.constraints, original.constraints);
        assert.deepEqual(reverted.triggers, original.triggers);
        assert.equal(policyChecks(reverted).length, 0);
        assert.deepEqual(nonPolicyTables(reverted), nonPolicyTables(sanitized));
        assert.deepEqual(await diagnostics(observer), sanitizedRows);
        assert.deepEqual(await fingerprints(), beforeXmin);
        assert.deepEqual(await applied(), originalHistory);
        requireOnlyDiagnosticMigration(await executor().getPendingMigrations());
      },
    );

    await scenario(
      'reapply restores all checks without rewriting already sanitized rows',
      async () => {
        const beforeXmin = await fingerprints();
        await executor().executePendingMigrations();
        const reapplied = await inventory(observer);
        assert.deepEqual(reapplied.constraints, sanitized.constraints);
        assert.deepEqual(reapplied.triggers, sanitized.triggers);
        assert.deepEqual(nonPolicyTables(reapplied), nonPolicyTables(sanitized));
        assert.deepEqual(await diagnostics(observer), sanitizedRows);
        assert.deepEqual(await fingerprints(), beforeXmin);
        assert.deepEqual(
          (await applied()).filter((row) => row.name !== POLICY),
          originalHistory,
        );
        assert.equal((await applied()).filter((row) => row.name === POLICY).length, 1);
        assert.deepEqual(await executor().getPendingMigrations(), []);
      },
    );
    assert.equal(passed.length, 6);
    const result = {
      result: 'success',
      scenarios: passed.length,
      passed,
      locksObserved,
      checkoutSha: environment.GITHUB_SHA ?? null,
      migrations: (await applied()).length,
      transaction: 'all',
      lockTimeoutMilliseconds: 1000,
      statementTimeoutMilliseconds: 5000,
      tablesCompared: Object.keys(original.tables).length,
      preservedTargetlessSchedules: targetless,
      diagnosticRowsPerTable: 2,
      policyConstraints: 4,
      oldSqlWritesRejected: 4,
      productionChanges: false,
      workerDrainVerified: false,
      productionLockBudgetVerified: false,
      deploymentAuthorized: false,
      keyRetirementAuthorized: false,
    };
    mkdirSync('tmp/r05g-preflight', { recursive: true });
    writeFileSync(
      'tmp/r05g-preflight/diagnostic-migration-result.json',
      JSON.stringify(result, null, 2) + '\n',
    );
    console.log(JSON.stringify(result));
  } finally {
    const cleanup = await Promise.allSettled(
      connections.map(async (connection) => {
        try {
          if (connection.isTransactionActive) await connection.rollbackTransaction();
          if (!connection.isReleased) {
            await connection.query('RESET lock_timeout');
            await connection.query('RESET statement_timeout');
            await connection.query('RESET idle_in_transaction_session_timeout');
          }
        } finally {
          if (!connection.isReleased) await connection.release();
        }
      }),
    );
    assert.ok(
      cleanup.every((outcome) => outcome.status === 'fulfilled'),
      'Every test connection must be released.',
    );
  }
}

export async function verifyDiagnosticMigrationRehearsal(database, environment = process.env) {
  try {
    await rehearse(database, environment);
  } catch (error) {
    const code = codeOf(error);
    const safeCode =
      typeof code === 'string' && /^(?:[0-9A-Z]{5}|ERR_ASSERTION)$/u.test(code) ? code : 'unknown';
    throw new Error(
      `Diagnostic Migration rehearsal failed (${safeCode}); raw SQL, rows and diagnostics withheld.`,
    );
  }
}
