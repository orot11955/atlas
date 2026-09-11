import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertEmptyRestoreTarget,
  insertDisabledEndpointFixture,
  postgresArguments,
  validateRestoreEnvironment,
} from './eventing-restore-e2e.mjs';

const environment = {
  NODE_ENV: 'test',
  ATLAS_ALLOW_EVENTING_RESTORE_TESTS: '1',
  ATLAS_EVENTING_RESTORE_SOURCE_URL:
    'postgresql://atlas:fixture-only@127.0.0.1:5432/atlas_eventing_preflight_test',
  ATLAS_EVENTING_TEST_POSTGRES_CONTAINER: 'a'.repeat(64),
};

test('the rehearsal accepts only a separate fixed destination and explicit test source', () => {
  const input = validateRestoreEnvironment(environment);
  assert.equal(input.source.pathname, '/atlas_eventing_preflight_test');
  assert.equal(input.destination.pathname, '/atlas_eventing_restore_test');
  assert.notEqual(input.source.href, input.destination.href);
});

test('operational URLs, alternate databases, roles, ports and URL options are rejected', () => {
  for (const url of [
    'postgresql://atlas:x@production.example:5432/atlas_eventing_preflight_test',
    'postgresql://atlas:x@127.0.0.1:5432/atlas',
    'postgresql://atlas:x@127.0.0.1:5432/atlas_eventing_restore_test',
    'postgresql://postgres:x@127.0.0.1:5432/atlas_eventing_preflight_test',
    'postgresql://atlas:x@127.0.0.1:5433/atlas_eventing_preflight_test',
    environment.ATLAS_EVENTING_RESTORE_SOURCE_URL + '?options=-csearch_path=other',
    environment.ATLAS_EVENTING_RESTORE_SOURCE_URL + '#fragment',
  ]) {
    assert.throws(() =>
      validateRestoreEnvironment({ ...environment, ATLAS_EVENTING_RESTORE_SOURCE_URL: url }),
    );
  }
});

test('test flags are mandatory and DATABASE_URL is not an implicit restore source', () => {
  for (const change of [
    { NODE_ENV: 'production' },
    { ATLAS_ALLOW_EVENTING_RESTORE_TESTS: undefined },
    {
      ATLAS_EVENTING_RESTORE_SOURCE_URL: undefined,
      DATABASE_URL: environment.ATLAS_EVENTING_RESTORE_SOURCE_URL,
    },
  ])
    assert.throws(() => validateRestoreEnvironment({ ...environment, ...change }));
  assert.throws(() => validateRestoreEnvironment(environment, ['--apply']));
});

test('container selection is an exact service ID and never a shell fragment', () => {
  for (const value of ['postgres', 'a'.repeat(63), 'a'.repeat(64) + ';echo bad', '', undefined]) {
    assert.throws(() =>
      validateRestoreEnvironment({ ...environment, ATLAS_EVENTING_TEST_POSTGRES_CONTAINER: value }),
    );
  }
});

test('native client arguments preserve all restore checks and never clean or disable triggers', () => {
  const container = environment.ATLAS_EVENTING_TEST_POSTGRES_CONTAINER;
  const dump = postgresArguments(container, 'dump');
  const restore = postgresArguments(container, 'restore');
  assert.ok(dump.includes('--format=custom'));
  assert.ok(dump.includes('--dbname=atlas_eventing_preflight_test'));
  for (const argument of [
    '--exit-on-error',
    '--single-transaction',
    '--dbname=atlas_eventing_restore_test',
  ]) {
    assert.ok(restore.includes(argument));
  }
  for (const args of [dump, restore, postgresArguments(container, 'identity')]) {
    assert.ok(args.includes(container));
    assert.ok(
      !args.some((argument) =>
        /--(?:clean|create|disable-triggers|data-only|section)|sh|bash/u.test(argument),
      ),
    );
  }
  assert.throws(() => postgresArguments(container, 'clean'));
});

test('a truly empty fixed target passes the pre-restore guard', async () => {
  const queries = [];
  const database = {
    async query(sql) {
      queries.push(sql);
      return sql.includes('current_database')
        ? [{ name: 'atlas_eventing_restore_test' }]
        : [{ count: 0 }];
    },
  };
  await assertEmptyRestoreTarget(database);
  assert.equal(queries.length, 2);
  assert.ok(queries.every((sql) => sql.startsWith('SELECT')));
});

test('existing tables or sequences block restore before any client is invoked', async () => {
  const database = {
    async query(sql) {
      return sql.includes('current_database')
        ? [{ name: 'atlas_eventing_restore_test' }]
        : [{ count: 1 }];
    },
  };
  await assert.rejects(assertEmptyRestoreTarget(database), /populated restore destination/u);
});

test('wrong destination fails before object enumeration', async () => {
  let queries = 0;
  const database = {
    async query() {
      queries += 1;
      return [{ name: 'atlas_eventing_preflight_test' }];
    },
  };
  await assert.rejects(assertEmptyRestoreTarget(database), /fixed disposable destination/u);
  assert.equal(queries, 1);
});

test('disabled fixtures use active creation and versioned disable in the same transaction', async () => {
  const transaction = {};
  const at = new Date('2030-01-01T00:00:00Z');
  const input = { id: 'endpoint', workspaceId: 'workspace', version: 1, createdAt: at, updatedAt: at };
  const calls = [];
  const repository = {
    async insertWebhookEndpoint(row, tx) {
      assert.equal(tx, transaction);
      calls.push(row);
    },
    async setWebhookEndpointStatus(workspaceId, endpointId, update, tx) {
      assert.equal(tx, transaction);
      assert.equal(workspaceId, input.workspaceId);
      assert.equal(endpointId, input.id);
      calls.push(update);
      return true;
    },
  };
  await insertDisabledEndpointFixture(repository, input, transaction);
  assert.deepEqual(calls, [
    { ...input, status: 'active' },
    { expectedVersion: 1, nextVersion: 2, status: 'disabled', disabledAt: at, updatedAt: at },
  ]);
  await assert.rejects(
    insertDisabledEndpointFixture(
      { ...repository, setWebhookEndpointStatus: async () => false },
      input,
      transaction,
    ),
    /versioned status transition/u,
  );
});
