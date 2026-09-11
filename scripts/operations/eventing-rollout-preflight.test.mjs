import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  collectEventingPreflight,
  parsePreflightArguments,
} from './eventing-rollout-preflight.mjs';

const workspace = '01991892-1000-7000-8000-000000000003';
const counts = { total: '1' };
function connection(overrides = {}) {
  const queries = [];
  return {
    queries,
    isTransactionActive: false,
    async startTransaction(level) {
      queries.push(['begin', level]);
      this.isTransactionActive = true;
    },
    async rollbackTransaction() {
      queries.push(['rollback']);
      this.isTransactionActive = false;
    },
    async query(sql, parameters) {
      queries.push([sql, parameters]);
      if (sql.startsWith('SET ')) return [];
      if (sql.includes('FROM public.workspaces')) return [{ id: workspace }];
      if (sql.includes("current_setting('transaction_read_only')")) {
        return [
          { read_only: 'on', isolation: 'repeatable read', observed_at: '2026-09-09T00:00:00Z' },
        ];
      }
      if (sql.includes('diagnostic_policy_applied')) return [{ diagnostic_policy_applied: false }];
      return [counts];
    },
    ...overrides,
  };
}

test('arguments require one explicit UUIDv7 scope and reject all writes and unknown flags', () => {
  assert.deepEqual(parsePreflightArguments(['--workspace', workspace]), { workspaceId: workspace });
  assert.deepEqual(parsePreflightArguments(['--help']), { help: true });
  for (const args of [
    [],
    ['--apply'],
    ['--workspace', 'bad'],
    ['--workspace', workspace, '--apply'],
    ['--key', 'secret'],
    ['--workspace', workspace.replace('7000', '4000')],
  ]) {
    assert.throws(() => parsePreflightArguments(args));
  }
});
test('read-only mode precedes data reads and every successful snapshot is rolled back', async () => {
  const db = connection();
  const result = await collectEventingPreflight(db, workspace);
  assert.deepEqual(db.queries[0], ['begin', 'REPEATABLE READ']);
  assert.equal(db.queries[1][0], 'SET TRANSACTION READ ONLY');
  assert.deepEqual(db.queries.at(-1), ['rollback']);
  assert.equal(result.deploymentAuthorized, false);
  assert.equal(result.keyRetirementAuthorized, false);
  assert.equal(result.assessment, 'inventory-only');
  assert.ok(
    db.queries
      .filter(([sql]) => sql.includes('workspace_id=$1'))
      .every(([, params]) => params[0] === workspace),
  );
});
test('missing Workspace fails rather than reporting an empty successful inventory', async () => {
  const db = connection({
    async query(sql) {
      return sql.startsWith('SET ') ? [] : [];
    },
  });
  await assert.rejects(collectEventingPreflight(db, workspace), /Workspace not found/u);
  assert.deepEqual(db.queries.at(-1), ['rollback']);
});
test('nested transactions and malformed scopes fail before querying', async () => {
  for (const [db, scope] of [
    [connection({ isTransactionActive: true }), workspace],
    [connection(), 'invalid'],
  ]) {
    await assert.rejects(collectEventingPreflight(db, scope));
    assert.equal(db.queries.length, 0);
  }
});
test('SQL failure rolls back and CLI emits no raw exception or configuration', async () => {
  const db = connection({
    async query() {
      throw new Error('secret-sentinel');
    },
  });
  await assert.rejects(collectEventingPreflight(db, workspace));
  assert.deepEqual(db.queries.at(-1), ['rollback']);
  const cli = spawnSync(
    process.execPath,
    [
      new URL('./eventing-rollout-preflight.mjs', import.meta.url).pathname,
      '--workspace',
      workspace,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, ATLAS_EVENTING_PREFLIGHT_DATABASE_URL: 'secret-sentinel-invalid-url' },
    },
  );
  assert.equal(cli.status, 1);
  assert.equal(cli.stdout, '');
  assert.ok(!cli.stderr.includes('secret-sentinel'));
  assert.ok(!cli.stderr.includes('at runEventing'));
});
test('database READ WRITE mode or malformed aggregate results cannot claim readOnly', async () => {
  for (const badMode of [true, false]) {
    const db = connection();
    const original = db.query.bind(db);
    db.query = async (sql, params) => {
      if (badMode && sql.includes("current_setting('transaction_read_only')")) {
        return [{ read_only: 'off', isolation: 'repeatable read' }];
      }
      if (!badMode && sql.includes('count(*)')) return [{ total: 'secret-sentinel' }];
      return original(sql, params);
    };
    await assert.rejects(collectEventingPreflight(db, workspace));
    assert.deepEqual(db.queries.at(-1), ['rollback']);
  }
});
