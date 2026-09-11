import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This runner never uses DATABASE_URL or the application's configured DataSource.
const url = new URL(process.env.ATLAS_SCHEMA_TEST_DATABASE_URL ?? '');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.ATLAS_ALLOW_SCHEMA_TESTS, '1');
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.equal(url.pathname, '/atlas_schedule_schema_test');
assert.equal(url.search, '');
assert.equal(url.hash, '');
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(resolve(root, 'packages/database/package.json'));
const { DataSource } = require('typeorm');
const { PublicationScheduleEntity } = require('@atlas/server');
const migrationDirectory = resolve(root, 'packages/database/dist/migrations');
const targetFile = '1788652800000-ExpandPublicationScheduleTargets.js';
const { ExpandPublicationScheduleTargets1788652800000: TargetMigration } = require(
  resolve(migrationDirectory, targetFile),
);
const migration = new TargetMigration();
const schema = `atlas_r02_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^atlas_r02_[0-9a-f]{32}$/u);
const ds = new DataSource({
  type: 'postgres',
  url: url.href,
  schema,
  entities: [PublicationScheduleEntity],
  synchronize: false,
  migrationsRun: false,
  logging: false,
  extra: { options: `-c search_path=${schema} -c lock_timeout=5000 -c statement_timeout=30000` },
});
await ds.initialize();
const runner = ds.createQueryRunner();
await runner.connect();
let ownsSchema = false;
let passed = 0;
const admin = randomUUID();

async function transaction(operation, rollback = false) {
  await runner.startTransaction();
  try {
    const value = await operation();
    if (rollback) await runner.rollbackTransaction();
    else await runner.commitTransaction();
    return value;
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  }
}

async function scenario(name, operation, rollback = true) {
  await transaction(operation, rollback);
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function rejectsSql(operation, code, message) {
  // Nested QueryRunner transactions are savepoints; expected errors cannot poison the suite.
  await assert.rejects(
    () => transaction(operation),
    (error) => {
      assert.equal(error.driverError?.code ?? error.code, code);
      if (message) assert.match(error.message, message);
      return true;
    },
  );
}

async function hasTargetColumn() {
  const rows = await runner.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'publication_schedules'
       AND column_name = 'target_publication_id'`,
    [schema],
  );
  return rows.length === 1;
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

async function insertSchedule(context, overrides = {}) {
  const row = {
    id: randomUUID(),
    workspace_id: context.workspace,
    site_id: context.site,
    content_id: context.content,
    content_site_id: context.contentSite,
    action: 'publish',
    scheduled_for: new Date('2030-01-01T00:00:00Z'),
    timezone: 'UTC',
    scheduled_local_at: '2030-01-01T00:00',
    // Terminal fixtures do not interfere with the one-open-schedule uniqueness rule.
    status: 'cancelled',
    next_attempt_at: new Date('2030-01-01T00:00:00Z'),
    cancelled_at: new Date('2026-01-01T00:00:00Z'),
    requested_by_admin_account_id: admin,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    revision_id: null,
    revision_number: null,
    ...overrides,
  };
  const keys = Object.keys(row);
  for (const key of keys) assert.match(key, /^[a-z_]+$/u);
  await runner.query(
    `INSERT INTO publication_schedules (${keys.map((key) => `"${key}"`).join(', ')})
     VALUES (${keys.map((_, index) => `$${index + 1}`).join(', ')})`,
    keys.map((key) => row[key]),
  );
  return row.id;
}

try {
  await runner.query(`CREATE SCHEMA "${schema}"`);
  ownsSchema = true;
  const baselineFiles = readdirSync(migrationDirectory)
    .filter((file) => /^\d+-.+\.js$/u.test(file) && file < targetFile)
    .sort();
  assert.ok(baselineFiles.includes('1788130900000-AlignPublicationScheduleRevisionTarget.js'));
  await transaction(async () => {
    for (const file of baselineFiles) {
      const classes = Object.values(require(resolve(migrationDirectory, file))).filter(
        (value) => typeof value === 'function' && typeof value.prototype.up === 'function',
      );
      assert.equal(classes.length, 1, file);
      await new classes[0]().up(runner);
    }
    await runner.query(
      `INSERT INTO admin_accounts (id, email, display_name, password_hash, role,
         password_changed_at, created_at, updated_at)
       VALUES ($1, 'schema-fixture@atlas.test', 'Schema fixture', '$argon2id$fixture-only',
         'owner', now(), now(), now())`,
      [admin],
    );
  });
  console.log(`Applied ${baselineFiles.length} real historical migration classes in ${schema}`);
  const a = await transaction(() => makeContext());
  const b = await transaction(() => makeContext());
  const sibling = await transaction(() => makeContext(a.workspace));
  const legacyId = await insertSchedule(a, { status: 'pending', cancelled_at: null });
  await insertSchedule(a, { revision_id: a.revision, revision_number: 1 });
  const before = await runner.query('SELECT * FROM publication_schedules ORDER BY id');

  await assert.rejects(() => migration.up(runner), /requires a transaction/u);
  passed += 1;
  console.log(`ok ${passed} - nontransactional migration is rejected before DDL`);
  for (const [name, overrides] of [
    ['partial revision pair', { revision_id: a.revision }],
    ['foreign revision workspace', { revision_id: b.revision, revision_number: 1 }],
    ['foreign revision content', { revision_id: sibling.revision, revision_number: 1 }],
    ['wrong revision number', { revision_id: a.revision, revision_number: 2 }],
    ['content/site mismatch', { content_site_id: sibling.contentSite }],
    ['cross-workspace content', { content_id: b.content }],
  ]) {
    await scenario(`upgrade refuses legacy ${name} without changing rows or schema`, async () => {
      const id = await insertSchedule(a, overrides);
      await rejectsSql(() => migration.up(runner), '23514', /R02 preflight/u);
      assert.equal(await hasTargetColumn(), false);
      const rows = await runner.query('SELECT id FROM publication_schedules WHERE id = $1', [id]);
      assert.equal(rows.length, 1);
    });
  }
  await scenario(
    'upgrade preserves existing data and leaves absent targets NULL',
    async () => {
      await migration.up(runner);
      const after = await runner.query('SELECT * FROM publication_schedules ORDER BY id');
      assert.deepEqual(
        after.map(({ target_publication_id: target, ...row }) => {
          assert.equal(target, null);
          return row;
        }),
        before,
      );
    },
    false,
  );

  await scenario(
    'Entity columns match the expanded table and nullable target can be read',
    async () => {
      const columns = await runner.query(
        `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'publication_schedules'`,
        [schema],
      );
      assert.deepEqual(
        ds
          .getMetadata(PublicationScheduleEntity)
          .columns.map((column) => column.databaseName)
          .sort(),
        columns.map((column) => column.column_name).sort(),
      );
      const row = await runner.manager
        .getRepository(PublicationScheduleEntity)
        .findOneByOrFail({ id: legacyId });
      assert.equal(row.targetPublicationId, null);
    },
  );

  for (const [name, overrides, code] of [
    ['ID without number', { revision_id: a.revision }, '23514'],
    ['number without ID', { revision_number: 1 }, '23514'],
    ['nonpositive number', { revision_id: a.revision, revision_number: 0 }, '23514'],
    ['wrong revision number', { revision_id: a.revision, revision_number: 2 }, '23503'],
    ['foreign revision content', { revision_id: sibling.revision, revision_number: 1 }, '23503'],
    ['foreign revision workspace', { revision_id: b.revision, revision_number: 1 }, '23503'],
    ['foreign content', { content_id: b.content }, '23503'],
    ['foreign content/site', { content_site_id: sibling.contentSite }, '23503'],
    ['foreign site', { site_id: sibling.site }, '23503'],
    ['publication on publish', { target_publication_id: a.publication }, '23514'],
    [
      'revision on withdraw',
      { action: 'withdraw', revision_id: a.revision, revision_number: 1 },
      '23514',
    ],
    [
      'foreign publication scope',
      { action: 'withdraw', target_publication_id: sibling.publication },
      '23503',
    ],
    [
      'foreign publication workspace',
      { action: 'withdraw', target_publication_id: b.publication },
      '23503',
    ],
  ]) {
    await scenario(`new insert rejects ${name}`, () =>
      rejectsSql(() => insertSchedule(a, overrides), code),
    );
  }
  await scenario('same-owner revision target is accepted and cannot be cleared', async () => {
    const id = await insertSchedule(a, { revision_id: a.revision, revision_number: 1 });
    await rejectsSql(
      () =>
        runner.query(
          'UPDATE publication_schedules SET revision_id = NULL, revision_number = NULL WHERE id = $1',
          [id],
        ),
      '23514',
      /targets are immutable/u,
    );
  });
  await scenario('publication target is accepted; lossless rollback is enforced', async () => {
    const id = await insertSchedule(a, {
      action: 'withdraw',
      target_publication_id: a.publication,
    });
    await rejectsSql(() => migration.down(runner), '23514', /rollback refused/u);
    assert.equal(await hasTargetColumn(), true);
    const [row] = await runner.query(
      'SELECT target_publication_id FROM publication_schedules WHERE id = $1',
      [id],
    );
    assert.equal(row.target_publication_id, a.publication);
    const entity = await runner.manager
      .getRepository(PublicationScheduleEntity)
      .findOneByOrFail({ id });
    assert.equal(entity.targetPublicationId, a.publication);
    await rejectsSql(
      () =>
        runner.query(
          'UPDATE publication_schedules SET target_publication_id = NULL WHERE id = $1',
          [id],
        ),
      '23514',
      /targets are immutable/u,
    );
  });
  await scenario('legacy NULL targets cannot be silently backfilled', () =>
    rejectsSql(
      () =>
        runner.query(
          'UPDATE publication_schedules SET revision_id = $2, revision_number = 1 WHERE id = $1',
          [legacyId, a.revision],
        ),
      '23514',
      /targets are immutable/u,
    ),
  );
  await scenario('lifecycle-only updates still work', async () => {
    await runner.query(
      `UPDATE publication_schedules SET status = 'cancelled', cancelled_at = now(),
         updated_at = now(), version = version + 1 WHERE id = $1`,
      [legacyId],
    );
    const [row] = await runner.query(
      'SELECT status, version FROM publication_schedules WHERE id = $1',
      [legacyId],
    );
    assert.equal(row.status, 'cancelled');
    assert.equal(row.version, 2);
  });
  await scenario(
    'empty-target rollback preserves historical rows and reapplies',
    async () => {
      await migration.down(runner);
      assert.equal(await hasTargetColumn(), false);
      assert.deepEqual(
        await runner.query('SELECT * FROM publication_schedules ORDER BY id'),
        before,
      );
      await migration.up(runner);
      assert.equal(await hasTargetColumn(), true);
    },
    false,
  );
  console.log(
    JSON.stringify({
      result: 'success',
      scenarios: passed,
      baselineMigrations: baselineFiles.length,
    }),
  );
} finally {
  if (runner.isTransactionActive) await runner.rollbackTransaction();
  if (ownsSchema) await runner.query(`DROP SCHEMA "${schema}" CASCADE`);
  await runner.release();
  await ds.destroy();
}
