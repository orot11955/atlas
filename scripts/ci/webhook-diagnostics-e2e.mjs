import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
  AuditService, FixedClock, TypeOrmAuditRepository, TypeOrmEventingRepository,
  WebhookDeliveryService, createUuidV7,
} = require('@atlas/server');
const { WebhookTransportError, WEBHOOK_RESPONSE_OMITTED } = require(resolve(root,
  'packages/server/dist/modules/eventing/domain/webhook-diagnostics.js'));
const schema = `atlas_webhook_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^atlas_webhook_[a-f0-9]{32}$/u);
const ds = new DataSource({
  type: 'postgres', url: url.href, schema,
  entities: [...new Set(getMetadataArgsStorage().tables.map((table) => table.target))],
  synchronize: false, migrationsRun: false, logging: false,
  extra: { options: `-c search_path=${schema} -c lock_timeout=10000 -c statement_timeout=20000` },
});
await ds.initialize();
const control = ds.createQueryRunner();
const a = ds.createQueryRunner();
const b = ds.createQueryRunner();
await Promise.all([control.connect(), a.connect(), b.connect()]);
const now = new Date('2030-01-01T00:00:00.000Z');
const clock = new FixedClock(now);
const admin = createUuidV7();
const secret = 'diagnostic-secret-marker-never-retain';
const signedBody = '{"original":"signed-request-preserved"}';
const repository = new TypeOrmEventingRepository(ds);
const auditRepository = new TypeOrmAuditRepository(ds);
const audit = new AuditService(auditRepository, clock);
let ownsSchema = false;
let passed = 0;

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
async function scenario(name, work) {
  await work(); passed += 1; console.log(`ok ${passed} - ${name}`);
}
function service(connection, send, auditService = audit, at = now) {
  return new WebhookDeliveryService(
    { run: (work) => tx(connection, work) }, repository,
    { send: async (request) => {
      assert.equal(connection.isTransactionActive, false);
      return send(request);
    } },
    { decrypt: () => 's'.repeat(48) }, auditService,
    { timeoutMilliseconds: 100, endpointFailureThreshold: 3 }, new FixedClock(at),
  );
}
async function fixture() {
  const c = { workspace: createUuidV7(), site: createUuidV7(), event: createUuidV7(),
    endpoint: createUuidV7(), delivery: createUuidV7() };
  await tx(control, async (m) => {
    await m.query(`INSERT INTO workspaces (id,key,name,timezone,locale,created_at,updated_at)
      VALUES($1,$2,'Fixture','UTC','en',$3,$3)`, [c.workspace, `w-${c.workspace}`, now]);
    await m.query(`INSERT INTO sites (id,workspace_id,key,name,type,status,timezone,locale,created_at,updated_at)
      VALUES($1,$2,$3,'Fixture','blog','active','UTC','en',$4,$4)`, [c.site,c.workspace,`s-${c.site}`,now]);
    const aggregate = createUuidV7();
    await repository.insertOutboxEvent({
      id:c.event, workspaceId:c.workspace, siteId:c.site, aggregateType:'content-publication',
      aggregateId:aggregate, eventType:'content.published', schemaVersion:1,
      payload:{ eventId:c.event,workspaceId:c.workspace,siteId:c.site,aggregateId:aggregate,
        eventType:'content.published',schemaVersion:1,occurredAt:now.toISOString(),
        data:{publicationId:aggregate,contentId:createUuidV7(),contentSiteId:createUuidV7(),
          revisionId:createUuidV7(),revisionNumber:1,slug:'fixture',etag:'a'.repeat(64),visibility:'public'} },
      status:'dispatched',availableAt:now,dispatchedAt:now,attemptCount:1,createdAt:now,updatedAt:now,
    },m);
    await repository.insertWebhookEndpoint({
      id:c.endpoint,workspaceId:c.workspace,siteId:c.site,name:'Fixture',url:'https://hooks.example.com',
      status:'active',secretCiphertext:'fixture',secretKeyVersion:'v1',subscribedEvents:['content.published'],
      consecutiveFailureCount:0,version:1,createdByAdminAccountId:admin,createdAt:now,updatedAt:now,
    },m);
    await repository.insertWebhookDeliveryIfAbsent({id:c.delivery,workspaceId:c.workspace,
      endpointId:c.endpoint,eventId:c.event,eventType:'content.published',createdAt:now},m);
  });
  return c;
}
async function snapshot(c) {
  const [delivery] = await control.query('SELECT * FROM webhook_deliveries WHERE id=$1',[c.delivery]);
  const attempts = await control.query('SELECT * FROM webhook_delivery_attempts WHERE delivery_id=$1 ORDER BY attempt_number',[c.delivery]);
  const logs = await control.query('SELECT * FROM audit_logs WHERE workspace_id=$1 ORDER BY id',[c.workspace]);
  const [event] = await control.query('SELECT * FROM outbox_events WHERE id=$1',[c.event]);
  return {delivery,attempts,logs,event};
}
async function blockedWrite(table, field, id, value) {
  await assert.rejects(tx(control,m=>m.query(`UPDATE ${table} SET ${field}=$2 WHERE id=$1`,[id,value])),
    error => (error.driverError?.code ?? error.code) === '23514');
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise,new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('Webhook test barrier timed out.')),5_000);
    })]);
  } finally { clearTimeout(timer); }
}

try {
  await control.query(`CREATE SCHEMA "${schema}"`); ownsSchema=true;
  const directory=resolve(root,'packages/database/dist/migrations');
  const files=readdirSync(directory).filter(f=>/^\d+-.+\.js$/u.test(f)).sort();
  const migrations=files.map(file=>{
    const types=Object.values(require(resolve(directory,file))).filter(v=>typeof v==='function' && typeof v.prototype.up==='function');
    assert.equal(types.length,1); return new types[0]();
  });
  const index=migrations.findIndex(m=>m.name==='EnforceWebhookDiagnosticPolicy1788696000000');
  assert.ok(index>=0);
  for(const migration of migrations.slice(0,index)) await tx(control,()=>migration.up(control));
  await control.query(`INSERT INTO admin_accounts(id,email,display_name,password_hash,role,password_changed_at,created_at,updated_at)
    VALUES($1,'webhook@atlas.test','Fixture','$argon2id$fixture-only','owner',$2,$2,$2)`,[admin,now]);
  const legacy=await fixture();
  const legacyAttempt=createUuidV7();
  await control.query(`UPDATE webhook_deliveries SET status='succeeded',attempt_count=1,completed_at=$2,
    last_response_status=200,last_response_excerpt=$3,last_error=$3 WHERE id=$1`,[legacy.delivery,now,secret]);
  await control.query(`INSERT INTO webhook_delivery_attempts(id,delivery_id,attempt_number,status,request_body,
    response_status,response_body_excerpt,error_message,requested_at,completed_at)
    VALUES($1,$2,1,'succeeded',$3,200,$4,$4,$5,$5)`,[legacyAttempt,legacy.delivery,signedBody,secret,now]);
  const before=await snapshot(legacy);
  for(const migration of migrations.slice(index)) await tx(control,()=>migration.up(control));
  console.log(`Applied ${migrations.length} actual migrations with pre-policy diagnostic fixtures.`);

  await scenario('legacy cleanup preserves all non-diagnostic fields and signed request bytes',async()=>{
    const after=await snapshot(legacy);
    const expected=structuredClone(before);
    expected.delivery.last_response_excerpt=WEBHOOK_RESPONSE_OMITTED;
    expected.delivery.last_error='Webhook diagnostic: processing-failed.';
    expected.attempts[0].response_body_excerpt=WEBHOOK_RESPONSE_OMITTED;
    expected.attempts[0].error_message='Webhook diagnostic: processing-failed.';
    assert.deepEqual(after,expected);
    assert.equal(after.attempts[0].request_body,signedBody);
  });
  await scenario('database boundary refuses raw response and exception text in both tables',async()=>{
    await blockedWrite('webhook_deliveries','last_response_excerpt',legacy.delivery,secret);
    await blockedWrite('webhook_deliveries','last_error',legacy.delivery,secret);
    await blockedWrite('webhook_delivery_attempts','response_body_excerpt',legacyAttempt,secret);
    await blockedWrite('webhook_delivery_attempts','error_message',legacyAttempt,secret);
  });
  await scenario('success sanitizes alternate Sender output and duplicate execution is inert',async()=>{
    const c=await fixture();
    const delivery=service(a,async()=>({status:200,bodyExcerpt:secret}));
    await delivery.deliver(c.delivery,1);
    const after=await snapshot(c);
    assert.equal(after.delivery.status,'succeeded');
    assert.equal(after.delivery.last_response_excerpt,WEBHOOK_RESPONSE_OMITTED);
    assert.equal(after.attempts[0].response_body_excerpt,WEBHOOK_RESPONSE_OMITTED);
    assert.equal(after.logs.length,1);
    assert.doesNotMatch(JSON.stringify(after),/diagnostic-secret-marker/u);
    await delivery.deliver(c.delivery,1);
    assert.deepEqual(await snapshot(c),after);
  });
  await scenario('non-2xx body is omitted while status and persisted retry survive',async()=>{
    const c=await fixture();
    await service(a,async()=>({status:503,bodyExcerpt:secret})).deliver(c.delivery,1);
    const after=await snapshot(c);
    assert.equal(after.delivery.status,'retry_scheduled');
    assert.equal(after.delivery.last_response_status,503);
    assert.equal(after.delivery.last_error,'Webhook diagnostic: http-non-success.');
    assert.equal(after.delivery.next_retry_at.toISOString(),'2030-01-01T00:01:00.000Z');
    assert.doesNotMatch(JSON.stringify(after),/diagnostic-secret-marker/u);
  });
  await scenario('arbitrary errors, Deadline and invalid Sender statuses use fixed diagnostics',async()=>{
    for(const [send,expected] of [
      [async()=>{throw new Error(secret);},'processing-failed'],
      [async()=>{throw new WebhookTransportError('deadline-exceeded');},'deadline-exceeded'],
      [async()=>({status:Number.NaN,bodyExcerpt:secret}),'invalid-response'],
    ]) {
      const c=await fixture(); await service(a,send).deliver(c.delivery,1);
      const after=await snapshot(c);
      assert.equal(after.delivery.status,'retry_scheduled');
      assert.equal(after.delivery.last_error,`Webhook diagnostic: ${expected}.`);
      assert.equal(after.delivery.last_response_status,null);
      assert.doesNotMatch(JSON.stringify(after),/diagnostic-secret-marker/u);
    }
  });
  await scenario('late response cannot replace a recovered owner result or append Audit',async()=>{
    const c=await fixture();
    let enter;let release;
    const entered=new Promise(resolve=>{enter=resolve;});
    const response=new Promise(resolve=>{release=resolve;});
    const old=service(a,async()=>{enter();return response;}).deliver(c.delivery,1);
    void old.catch(()=>undefined);
    try {
      await bounded(entered);
      const later=new Date(now.getTime()+600_000);
      await tx(control,m=>repository.recoverStaleWebhookDeliveries(new Date(now.getTime()+1),later,m));
      await service(b,async()=>({status:200}),audit,later).deliver(c.delivery,2);
      const current=await snapshot(c);
      release({status:503,bodyExcerpt:secret});await bounded(old);
      assert.deepEqual(await snapshot(c),current);
      assert.equal(current.delivery.status,'succeeded');
    } finally { release({status:503,bodyExcerpt:secret});await bounded(old); }
  });
  await scenario('Audit failure rolls back the result without becoming a second HTTP failure',async()=>{
    const c=await fixture();
    const failing=new AuditService({insert:async(record,m)=>{
      await auditRepository.insert(record,m);throw new Error('Injected diagnostic Audit failure.');
    }},clock);
    await assert.rejects(service(a,async()=>({status:200,bodyExcerpt:secret}),failing).deliver(c.delivery,1),/Injected/u);
    const after=await snapshot(c);
    assert.equal(after.delivery.status,'processing');assert.equal(after.attempts[0].status,'processing');
    assert.equal(after.delivery.last_response_excerpt,null);assert.equal(after.logs.length,0);
  });
  await scenario('existing administration read model cannot expose old diagnostic content',async()=>{
    const items=await repository.listWebhookDeliveries(legacy.workspace,{limit:10});
    assert.equal(items.length,1);
    assert.equal(items[0].attempts[0].requestBody,signedBody);
    assert.doesNotMatch(JSON.stringify(items),/diagnostic-secret-marker/u);
  });
  await scenario('schema down/up never reconstructs discarded remote diagnostic text',async()=>{
    const sanitized=await snapshot(legacy);
    await tx(control,()=>migrations[index].down(control));
    assert.deepEqual(await snapshot(legacy),sanitized);
    await tx(control,()=>migrations[index].up(control));
    assert.deepEqual(await snapshot(legacy),sanitized);
  });
  assert.equal(passed,9);
  console.log(JSON.stringify({result:'success',scenarios:passed,migrations:migrations.length}));
} finally {
  for(const connection of [a,b,control]) if(connection.isTransactionActive) await connection.rollbackTransaction();
  await Promise.all([a.release(),b.release()]);
  if(ownsSchema) await control.query(`DROP SCHEMA "${schema}" CASCADE`);
  await control.release();await ds.destroy();
}
