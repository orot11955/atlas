import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BODY_MARKERS = ['[response body omitted by policy]', '[response body omitted: too large]'];
const ERROR_MARKERS = [
  'deadline-exceeded',
  'target-rejected',
  'dns-failed',
  'transport-failed',
  'response-incomplete',
  'invalid-response',
  'endpoint-disabled',
  'http-non-success',
  'processing-failed',
].map((code) => `Webhook diagnostic: ${code}.`);
ERROR_MARKERS.push('Recovered stale processing attempt.');

export function parsePreflightArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  if (args.length !== 2 || args[0] !== '--workspace' || !UUID_V7.test(args[1])) {
    throw new Error('Use --workspace UUIDv7. No write or key arguments are accepted.');
  }
  return { workspaceId: args[1] };
}

/** A dedicated connection is required. This reports inventory, never rollout approval. */
export async function collectEventingPreflight(connection, workspaceId) {
  if (!UUID_V7.test(workspaceId) || connection.isTransactionActive) {
    throw new Error('A valid Workspace and an idle dedicated connection are required.');
  }
  await connection.startTransaction('REPEATABLE READ');
  try {
    // Set READ ONLY before any data read, even when a caller supplied a write-capable role.
    await connection.query('SET TRANSACTION READ ONLY');
    await connection.query("SET LOCAL lock_timeout = '1000ms'");
    await connection.query("SET LOCAL statement_timeout = '5000ms'");
    await connection.query("SET LOCAL idle_in_transaction_session_timeout = '10000ms'");
    const [scope] = await connection.query('SELECT id FROM public.workspaces WHERE id=$1', [
      workspaceId,
    ]);
    if (!scope) throw new Error('Workspace not found.');
    const [mode] = await connection.query(
      `SELECT current_setting('transaction_read_only') AS read_only,
      current_setting('transaction_isolation') AS isolation,
      transaction_timestamp() AS observed_at`,
    );
    if (mode.read_only !== 'on' || mode.isolation !== 'repeatable read') {
      throw new Error('Read-only snapshot was not established.');
    }
    const [schedules] = await connection.query(
      `SELECT count(*)::text AS total,
      count(*) FILTER (WHERE status='pending')::text AS pending,
      count(*) FILTER (WHERE status='processing')::text AS processing,
      count(*) FILTER (WHERE status='failed')::text AS failed,
      count(*) FILTER (WHERE revision_id IS NULL AND revision_number IS NULL
        AND target_publication_id IS NULL)::text AS missing_target,
      count(*) FILTER (WHERE status='pending' AND revision_id IS NULL
        AND revision_number IS NULL AND target_publication_id IS NULL)::text AS pending_missing_target
      FROM public.publication_schedules WHERE workspace_id=$1`,
      [workspaceId],
    );
    const diagnostics = {};
    for (const [name, from, scopeColumn, body, error] of [
      ['deliveries', 'public.webhook_deliveries d', 'd.workspace_id', 'd.last_response_excerpt', 'd.last_error'],
      ['attempts', 'public.webhook_delivery_attempts a JOIN public.webhook_deliveries d ON d.id=a.delivery_id',
        'd.workspace_id', 'a.response_body_excerpt', 'a.error_message'],
    ]) {
      const [counts] = await connection.query(
        `SELECT count(*)::text AS total,
        count(*) FILTER (WHERE (${body} IS NOT NULL AND NOT (${body}=ANY($2::text[])))
          OR (${error} IS NOT NULL AND NOT (${error}=ANY($3::text[]))))::text AS rewrite_candidates
        FROM ${from} WHERE ${scopeColumn}=$1`,
        [workspaceId, BODY_MARKERS, ERROR_MARKERS],
      );
      diagnostics[name] = counts;
    }
    const [migration] = await connection.query(
      `SELECT EXISTS(SELECT 1 FROM public.atlas_migrations
      WHERE name='EnforceWebhookDiagnosticPolicy1788696000000') AS diagnostic_policy_applied`,
    );
    // Sizes describe the entire tables, NOT only this Workspace. No raw row is returned.
    const [tableBytes] = await connection.query(
      `SELECT pg_total_relation_size('public.webhook_deliveries')::text AS deliveries,
      pg_total_relation_size('public.webhook_delivery_attempts')::text AS attempts`,
    );
    for (const counts of [schedules, ...Object.values(diagnostics), tableBytes]) {
      if (!Object.values(counts).every((value) => typeof value === 'string' && /^\d+$/u.test(value))) {
        throw new Error('Invalid aggregate result.');
      }
    }
    return {
      schemaVersion: 1,
      assessment: 'inventory-only',
      workspaceId,
      observedAt: new Date(mode.observed_at).toISOString(),
      readOnly: true,
      isolation: mode.isolation,
      schedules,
      diagnostics,
      diagnosticPolicyApplied: migration.diagnostic_policy_applied,
      wholeTableBytes: tableBytes,
      missingTargetCountIsNotFullTargetValidation: true,
      deploymentAuthorized: false,
      keyRetirementAuthorized: false,
      checksNotPerformed: ['compose-forwarding', 'fleet-drain', 'backup-restore', 'key-coverage', 'lock-duration'],
    };
  } finally {
    // No COMMIT path. Read-only transactions still hold read locks until ended.
    await connection.rollbackTransaction();
  }
}

export async function runEventingPreflight(args, environment = process.env) {
  const input = parsePreflightArguments(args);
  if (input.help) {
    console.log('Read-only inventory: --workspace UUIDv7; requires ATLAS_EVENTING_PREFLIGHT_DATABASE_URL.');
    return;
  }
  const databaseUrl = environment.ATLAS_EVENTING_PREFLIGHT_DATABASE_URL;
  if (!databaseUrl) throw new Error('Explicit preflight database configuration is required.');
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.hash) {
    throw new Error('Invalid preflight database configuration.');
  }
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const require = createRequire(resolve(root, 'packages/database/package.json'));
  const { DataSource } = require('typeorm');
  const database = new DataSource({
    type: 'postgres',
    url: databaseUrl,
    entities: [],
    synchronize: false,
    migrationsRun: false,
    logging: false,
    extra: {
      max: 1,
      connectionTimeoutMillis: 5_000,
      options: '-c default_transaction_read_only=on -c lock_timeout=1000 -c statement_timeout=5000',
    },
  });
  try {
    await database.initialize();
    const connection = database.createQueryRunner();
    try {
      await connection.connect();
      console.log(JSON.stringify(await collectEventingPreflight(connection, input.workspaceId)));
    } finally {
      await connection.release();
    }
  } finally {
    if (database.isInitialized) await database.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runEventingPreflight(process.argv.slice(2)).catch(() => {
    // Never print SQL, connection URLs, database values, keys, exception messages or stacks.
    console.error('Eventing preflight failed. Check scope, schema, read access and timeout budgets.');
    process.exitCode = 1;
  });
}
