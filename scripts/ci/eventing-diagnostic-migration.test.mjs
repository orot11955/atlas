import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  requireOnlyDiagnosticMigration,
  validateDiagnosticRehearsal,
  verifyDiagnosticMigrationRehearsal,
} from './eventing-diagnostic-migration.mjs';

const environment = { NODE_ENV: 'test', ATLAS_ALLOW_DIAGNOSTIC_MIGRATION_TESTS: '1' };
const options = {
  url: 'postgresql://atlas:test-only@127.0.0.1:5432/atlas_eventing_preflight_test',
  synchronize: false,
  migrationsRun: false,
  logging: false,
  migrationsTableName: 'atlas_migrations',
};
const database = { options, isInitialized: true };
const policy = { name: 'EnforceWebhookDiagnosticPolicy1788696000000', instance: {} };

test('explicit isolated pre-policy database is accepted without issuing queries', () => {
  validateDiagnosticRehearsal(database, environment);
  validateDiagnosticRehearsal({ ...database, options: { ...options, schema: 'public' } }, environment);
});

test('test authorization, initialized state and disabled automatic writes are mandatory', () => {
  for (const env of [{}, { NODE_ENV: 'test' }, { ...environment, NODE_ENV: 'production' }]) {
    assert.throws(() => validateDiagnosticRehearsal(database, env));
  }
  for (const change of [
    { synchronize: true },
    { migrationsRun: true },
    { logging: true },
    { schema: 'production' },
    { migrationsTableName: 'other_history' },
  ]) {
    assert.throws(() => validateDiagnosticRehearsal({ ...database, options: { ...options, ...change } }, environment));
  }
  assert.throws(() => validateDiagnosticRehearsal({ ...database, isInitialized: false }, environment));
});

test('non-loopback hosts, other databases and URL options are rejected', () => {
  for (const url of [
    'postgresql://atlas:test-only@db.example:5432/atlas_eventing_preflight_test',
    'postgresql://atlas:test-only@127.0.0.1:5432/atlas',
    'postgresql://atlas:test-only@127.0.0.1:5432/atlas_eventing_restore_test',
    options.url + '?options=-csearch_path=other',
    options.url + '#fragment',
  ]) assert.throws(() => validateDiagnosticRehearsal({ ...database, options: { ...options, url } }, environment));
});

test('only the real remaining diagnostic migration may execute or revert', () => {
  requireOnlyDiagnosticMigration([policy]);
  for (const pending of [[], [{ name: 'OtherMigration' }], [policy, { name: 'LaterMigration' }],
    [{ ...policy, instance: { transaction: false } }]]) {
    assert.throws(() => requireOnlyDiagnosticMigration(pending));
  }
});

test('rejected setup exposes no URL, password or exception detail and never initializes a database', async () => {
  const url = 'postgresql://private-user:password-sentinel@db.example/production-sentinel';
  await assert.rejects(
    verifyDiagnosticMigrationRehearsal({ ...database, options: { ...options, url } }, environment),
    (error) => {
      assert.match(error.message, /Diagnostic Migration rehearsal failed/u);
      for (const value of ['private-user', 'password-sentinel', 'production-sentinel', url]) {
        assert.ok(!error.stack.includes(value));
      }
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});
