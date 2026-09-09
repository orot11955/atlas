import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.ATLAS_ALLOW_WEBHOOK_SAFETY_TESTS, '1');
const url = new URL(process.env.ATLAS_WEBHOOK_SAFETY_DATABASE_URL ?? '');
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.equal(url.pathname, '/atlas_webhook_safety_test');
assert.equal(url.search, '');
assert.equal(url.hash, '');
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(resolve(root, 'packages/database/package.json'));
const { DataSource, getMetadataArgsStorage } = require('typeorm');
const {
  Aes256GcmWebhookSecretCipher: Cipher,
  TypeOrmWebhookKeyMaintenanceRepository,
  WebhookKeyMaintenanceService,
  assertWebhookKeyCoverage,
  AuditService,
  TypeOrmAuditRepository,
  TypeOrmEventingRepository,
  ActorType,
  requestContext,
  createUuidV7,
} = require('@atlas/server');
const schema = `atlas_key_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^atlas_key_[0-9a-f]{32}$/u);
const database = new DataSource({
  type: 'postgres',
  url: url.href,
  schema,
  entities: [...new Set(getMetadataArgsStorage().tables.map((table) => table.target))],
  synchronize: false,
  migrationsRun: false,
  logging: false,
  extra: { options: `-c search_path=${schema} -c lock_timeout=5000 -c statement_timeout=20000` },
});
const k1 = Buffer.alloc(32, 0x13).toString('base64');
const k2 = Buffer.alloc(32, 0x27).toString('base64');
const legacy = new Cipher(k1, 'v1');
const current = new Cipher(k2, 'v2', JSON.stringify([{ version: 'v1', keyBase64: k1 }]));
const secret = 'signature-remains-identical-after-encryption-key-rotation';
const admin = createUuidV7();
const contexts = [];
let passed = 0;
let ownsSchema = false;
await database.initialize();
const control = database.createQueryRunner();
const a = database.createQueryRunner();
const b = database.createQueryRunner();
await Promise.all([control.connect(), a.connect(), b.connect()]);
const [{ pid: pidA }] = await a.query('SELECT pg_backend_pid() AS pid');
const [{ pid: pidB }] = await b.query('SELECT pg_backend_pid() AS pid');
assert.notEqual(pidA, pidB);
const repository = new TypeOrmWebhookKeyMaintenanceRepository(database);
const auditRepository = new TypeOrmAuditRepository(database);
const eventing = new TypeOrmEventingRepository(database);
async function tx(connection, work) {
  assert.equal(connection.isTransactionActive, false);
  await connection.startTransaction();
  try {
    const result = await work(connection.manager);
    await connection.commitTransaction();
    return result;
  } catch (error) {
    if (connection.isTransactionActive) await connection.rollbackTransaction();
    throw error;
  }
}
const service = (connection, audit = new AuditService(auditRepository)) =>
  new WebhookKeyMaintenanceService(
    { run: (work) => tx(connection, work) },
    repository,
    current,
    audit,
  );
function scoped(workspaceId, work) {
  const id = createUuidV7();
  return requestContext.run(
    {
      requestId: id,
      traceId: id,
      actorType: ActorType.SYSTEM,
      actorId: 'cli:webhook-encryption',
      workspaceId,
    },
    work,
  );
}
async function scenario(name, work) {
  await work();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}
async function fixture() {
  const c = {
    workspace: createUuidV7(),
    site: createUuidV7(),
    endpoints: [createUuidV7(), createUuidV7()],
  };
  await tx(control, async (m) => {
    await m.query(
      `INSERT INTO workspaces (id,key,name,timezone,locale,created_at,updated_at)
      VALUES($1,$2,'Keys','UTC','en',now(),now())`,
      [c.workspace, `w-${c.workspace}`],
    );
    await m.query(
      `INSERT INTO sites (id,workspace_id,key,name,type,status,timezone,locale,created_at,updated_at)
      VALUES($1,$2,$3,'Keys','blog','active','UTC','en',now(),now())`,
      [c.site, c.workspace, `s-${c.site}`],
    );
    for (const [i, id] of c.endpoints.entries()) {
      await eventing.insertWebhookEndpoint(
        {
          id,
          workspaceId: c.workspace,
          siteId: c.site,
          name: 'Fixture',
          url: `https://hooks.example.test/${id}`,
          status: 'active',
          secretCiphertext: legacy.encrypt(secret).encryptedValue,
          secretKeyVersion: 'v1',
          subscribedEvents: ['content.published'],
          consecutiveFailureCount: 0,
          version: 1,
          createdByAdminAccountId: admin,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        m,
      );
      if (i === 1) {
        await m.query(`UPDATE webhook_endpoints SET status='disabled',disabled_at=now() WHERE id=$1`, [id]);
      }
    }
  });
  contexts.push(c);
  return c;
}
async function snapshot(c) {
  return {
    rows: await control.query('SELECT * FROM webhook_endpoints WHERE workspace_id=$1 ORDER BY id', [c.workspace]),
    logs: await control.query('SELECT * FROM audit_logs WHERE workspace_id=$1 ORDER BY id', [c.workspace]),
  };
}
try {
  await control.query(`CREATE SCHEMA "${schema}"`);
  ownsSchema = true;
  const directory = resolve(root, 'packages/database/dist/migrations');
  const files = readdirSync(directory).filter((f) => /^\d+-.+\.js$/u.test(f)).sort();
  assert.ok(files.includes('1788696000000-EnforceWebhookDiagnosticPolicy.js'));
  for (const file of files) {
    const classes = Object.values(require(resolve(directory, file))).filter(
      (v) => typeof v === 'function' && typeof v.prototype.up === 'function',
    );
    assert.equal(classes.length, 1);
    await tx(control, () => new classes[0]().up(control));
  }
  await control.query(
    `INSERT INTO admin_accounts (id,email,display_name,password_hash,role,password_changed_at,created_at,updated_at)
    VALUES($1,'key-rotation@atlas.test','Fixture','$argon2id$fixture-only','owner',now(),now(),now())`,
    [admin],
  );

  await scenario('batch preserves signatures and every non-storage endpoint field including disabled state', async () => {
    const c = await fixture();
    const before = await snapshot(c);
    await scoped(c.workspace, () => service(a).reencryptBatch(c.workspace, 'v2', 50));
    const after = await snapshot(c);
    assert.equal(after.logs.length, 2);
    for (const [i, row] of after.rows.entries()) {
      const old = before.rows[i];
      assert.equal(row.secret_key_version, 'v2');
      const plaintext = current.decrypt(row.secret_ciphertext, 'v2');
      assert.equal(plaintext, secret);
      const sign = (value) => createHmac('sha256', value).update('time.event.body').digest('hex');
      assert.equal(sign(plaintext), sign(legacy.decrypt(old.secret_ciphertext, 'v1')));
      assert.deepEqual(
        { ...row, secret_ciphertext: old.secret_ciphertext, secret_key_version: old.secret_key_version },
        old,
      );
    }
    assert.equal((await scoped(c.workspace, () => service(a).reencryptBatch(c.workspace, 'v2'))).changed, 0);
    assert.equal((await snapshot(c)).logs.length, 2);
    const output = JSON.stringify(after.logs);
    for (const value of [secret, k1, k2, ...after.rows.map((row) => row.secret_ciphertext)]) {
      assert.ok(!output.includes(value), 'Audit must not contain secret material.');
    }
  });
  await scenario('Audit insertion failure rolls back the entire rewrite', async () => {
    const c = await fixture();
    const before = await snapshot(c);
    const failure = new AuditService({
      insert: async (record, m) => {
        await auditRepository.insert(record, m);
        throw new Error('Injected key Audit failure.');
      },
    });
    await assert.rejects(scoped(c.workspace, () => service(a, failure).reencryptBatch(c.workspace, 'v2')), /Injected/u);
    assert.deepEqual(await snapshot(c), before);
  });
  await scenario('tampered stored ciphertext fails without modifying earlier rows or Audit', async () => {
    const c = await fixture();
    const clean = await snapshot(c);
    const corruptId = clean.rows[1].id;
    await control.query('UPDATE webhook_endpoints SET secret_ciphertext=$2 WHERE id=$1', [corruptId, 'w1.invalid.invalid.invalid']);
    const before = await snapshot(c);
    await assert.rejects(scoped(c.workspace, () => service(a).reencryptBatch(c.workspace, 'v2')));
    assert.deepEqual(await snapshot(c), before);
    await control.query('UPDATE webhook_endpoints SET secret_ciphertext=$2 WHERE id=$1', [corruptId, clean.rows[1].secret_ciphertext]);
  });
  await scenario('a separate worker skips locked rows instead of overwriting or claiming completion', async () => {
    const c = await fixture();
    await a.startTransaction();
    try {
      await a.query('SELECT id FROM webhook_endpoints WHERE workspace_id=$1 FOR UPDATE', [c.workspace]);
      assert.equal((await scoped(c.workspace, () => service(b).reencryptBatch(c.workspace, 'v2'))).changed, 0);
      assert.equal((await snapshot(c)).logs.length, 0);
    } finally {
      await a.rollbackTransaction();
    }
    assert.equal((await scoped(c.workspace, () => service(b).reencryptBatch(c.workspace, 'v2'))).changed, 2);
  });
  await scenario('stale storage CAS cannot undo an ordinary signing-secret rotation', async () => {
    const c = await fixture();
    const old = (await snapshot(c)).rows[0];
    const replacementSecret = 'new-signing-secret-from-an-independent-administrator';
    const signed = legacy.encrypt(replacementSecret);
    await tx(a, (m) => eventing.rotateWebhookSecret(c.workspace, old.id, {
      expectedVersion: old.version,
      nextVersion: old.version + 1,
      secretCiphertext: signed.encryptedValue,
      secretKeyVersion: 'v1',
      updatedAt: new Date(),
    }, m));
    const currentRow = (await snapshot(c)).rows[0];
    assert.equal(await tx(b, (m) => repository.replaceCiphertext({
      id: old.id,
      workspaceId: old.workspace_id,
      ciphertext: old.secret_ciphertext,
      keyVersion: old.secret_key_version,
      version: old.version,
    }, current.encrypt(secret).encryptedValue, 'v2', m)), false);
    assert.deepEqual((await snapshot(c)).rows[0], currentRow);
    await scoped(c.workspace, () => service(b).reencryptBatch(c.workspace, 'v2'));
    const after = (await snapshot(c)).rows[0];
    assert.equal(current.decrypt(after.secret_ciphertext, after.secret_key_version), replacementSecret);
  });
  await scenario('coverage and retirement checks include other Workspaces and disabled endpoints', async () => {
    await fixture();
    await assertWebhookKeyCoverage(repository, current);
    await assert.rejects(assertWebhookKeyCoverage(repository, new Cipher(k2, 'v2')), /cover/u);
    await assert.rejects(service(a).assertRetirable('v1'), /references/u);
    await assert.rejects(service(a).assertRetirable('v2'), /active/u);
  });
  await scenario('unscoped operation and wrong active version cannot write', async () => {
    const c = await fixture();
    const before = await snapshot(c);
    await assert.rejects(service(a).reencryptBatch(c.workspace, 'v2'));
    await assert.rejects(scoped(c.workspace, () => service(a).reencryptBatch(c.workspace, 'wrong')));
    assert.deepEqual(await snapshot(c), before);
  });
  await scenario('after all stored references are rewritten only the new key is needed for DB rows', async () => {
    for (const c of contexts) {
      await scoped(c.workspace, () => service(a).reencryptBatch(c.workspace, 'v2', 50));
    }
    await assertWebhookKeyCoverage(repository, new Cipher(k2, 'v2'));
    await service(a).assertRetirable('v1');
    const inspection = await service(a).inspect();
    assert.ok(inspection.usage.every((item) => item.keyVersion === 'v2' && item.readable));
    const newOnly = new Cipher(k2, 'v2');
    for (const c of contexts) {
      for (const row of (await snapshot(c)).rows) {
        assert.equal(newOnly.decrypt(row.secret_ciphertext, 'v2'), current.decrypt(row.secret_ciphertext, 'v2'));
      }
    }
  });
  assert.equal(passed, 8);
  console.log(JSON.stringify({ result: 'success', scenarios: passed, migrations: files.length, workerSessions: [pidA, pidB] }));
} finally {
  for (const connection of [a, b, control]) {
    if (connection.isTransactionActive) await connection.rollbackTransaction();
  }
  await Promise.all([a.release(), b.release()]);
  if (ownsSchema) await control.query(`DROP SCHEMA "${schema}" CASCADE`);
  await control.release();
  await database.destroy();
}
