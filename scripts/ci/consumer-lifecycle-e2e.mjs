import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.ATLAS_ALLOW_CONSUMER_LIFECYCLE_TESTS, '1');
const db = new URL(process.env.ATLAS_CONSUMER_LIFECYCLE_DATABASE_URL ?? '');
const redis = new URL(process.env.ATLAS_CONSUMER_LIFECYCLE_REDIS_URL ?? '');
assert.ok(['postgres:', 'postgresql:'].includes(db.protocol));
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(db.hostname));
assert.equal(db.pathname, '/atlas_consumer_lifecycle_test');
assert.equal(db.search + db.hash, '');
assert.equal(redis.protocol, 'redis:');
assert.ok(['localhost', '127.0.0.1'].includes(redis.hostname));
assert.equal(redis.pathname, '/15');
assert.equal(redis.search + redis.hash + redis.username + redis.password, '');
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(resolve(root, 'packages/database/package.json'));
const workerRequire = createRequire(resolve(root, 'apps/worker/package.json'));
const { DataSource, getMetadataArgsStorage } = require('typeorm');
const { Queue, Worker } = workerRequire('bullmq');
const { BullMqEventingQueue } = workerRequire('./dist/eventing/bullmq-eventing.queue.js');
const { ActorType, requestContext, createUuidV7, FixedClock, AuditService,
  OutboxConsumerService, OutboxAdministrationService, OutboxRelayService,
  TypeOrmEventingRepository, TypeOrmAuditRepository } = require('@atlas/server');
const schema = `atlas_consumer_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^atlas_consumer_[a-f0-9]{32}$/u);
const ds = new DataSource({type:'postgres', url:db.href, schema,
  entities:[...new Set(getMetadataArgsStorage().tables.map(x=>x.target))], synchronize:false,
  migrationsRun:false, logging:false,
  extra:{options:`-c search_path=${schema} -c statement_timeout=20000 -c lock_timeout=10000`}});
await ds.initialize();
const control=ds.createQueryRunner(), a=ds.createQueryRunner(), b=ds.createQueryRunner();
await Promise.all([control.connect(),a.connect(),b.connect()]);
const [{pid:pidA}]=await a.query('SELECT pg_backend_pid() pid');
const [{pid:pidB}]=await b.query('SELECT pg_backend_pid() pid');
assert.notEqual(pidA,pidB);
const start=new Date('2030-01-01T00:00:00Z');
const admin=createUuidV7();
const repo=new TypeOrmEventingRepository(ds);
const auditRepo=new TypeOrmAuditRepository(ds);
const audit=new AuditService(auditRepo,new FixedClock(start));
let passed=0, ownsSchema=false;
async function tx(conn,work) {
  assert.equal(conn.isTransactionActive,false);
  await conn.startTransaction();
  try {const value=await work(conn.manager); await conn.commitTransaction(); return value;}
  catch(error) {await conn.rollbackTransaction();throw error;}
}
const runner=c=>({run:work=>tx(c,work)});
const noQueue={enqueueOutboxEvent:async()=>{},enqueueWebhookDelivery:async()=>{},enqueuePublicationSchedule:async()=>{}};
const consume=(conn,at=start,aud=audit)=>new OutboxConsumerService(runner(conn),repo,noQueue,aud,{staleMilliseconds:30_000},new FixedClock(at));
const service=(conn,at=start,aud=audit)=>new OutboxAdministrationService(runner(conn),repo,aud,new FixedClock(at));
const context=(c,work)=>requestContext.run({requestId:createUuidV7(),traceId:createUuidV7(),actorType:ActorType.ADMIN,actorId:admin,workspaceId:c.workspaceId},work);
async function scenario(name,work) {await work(); console.log(`ok ${++passed} - ${name}`);}
async function makeEvent(poison=false) {
  const c={workspaceId:createUuidV7(),siteId:createUuidV7(),eventId:createUuidV7(),aggregateId:createUuidV7()};
  await tx(control,async manager=>{
    await manager.query(`INSERT INTO workspaces(id,key,name,timezone,locale,created_at,updated_at) VALUES($1,$2,'Fixture','UTC','en',$3,$3)`,[c.workspaceId,`w-${c.workspaceId}`,start]);
    await manager.query(`INSERT INTO sites(id,workspace_id,key,name,type,status,timezone,locale,created_at,updated_at) VALUES($1,$2,$3,'Fixture','blog','active','UTC','en',$4,$4)`,[c.siteId,c.workspaceId,`s-${c.siteId}`,start]);
    await repo.insertOutboxEvent({id:c.eventId,workspaceId:c.workspaceId,siteId:c.siteId,aggregateId:c.aggregateId,
      aggregateType:'content-publication',eventType:'content.published',schemaVersion:1,
      payload:{eventId:c.eventId,workspaceId:c.workspaceId,siteId:c.siteId,aggregateId:c.aggregateId,eventType:'content.published',
        schemaVersion:1,occurredAt:start.toISOString(),data:poison?null:{publicationId:c.aggregateId,contentId:createUuidV7(),contentSiteId:createUuidV7(),revisionId:createUuidV7(),revisionNumber:1,slug:'fixture',etag:'e'.repeat(64),visibility:'public'}},
      status:'dispatched',availableAt:start,dispatchedAt:start,attemptCount:1,createdAt:start,updatedAt:start},manager);
  });
  return c;
}
const receipt=async c=>(await control.query('SELECT * FROM event_consumptions WHERE event_id=$1',[c.eventId]))[0];
const attemptRows=async c=>control.query(`SELECT h.* FROM event_consumption_attempts h JOIN event_consumptions c ON c.id=h.consumption_id WHERE c.event_id=$1 ORDER BY h.attempt_number`,[c.eventId]);
const failureAudit=new AuditService({insert:async (record,manager)=>{
  await auditRepo.insert(record,manager);if(record.action==='outbox.event-consumed') throw new Error('simulated transient effect failure');
}},new FixedClock(start));
async function exhaust(c) {
  let at=start;
  for(let i=1;i<=5;i++) {
    await assert.rejects(consume(a,at,failureAudit).consume(c.eventId),/simulated transient/);
    const r=await receipt(c);assert.equal(r.attempt_count,i);
    if(i<5) {
      assert.equal(r.status,'failed');
      assert.equal(r.next_attempt_at.getTime()-at.getTime(),[5000,30000,120000,600000][i-1]);
      assert.deepEqual(await consume(b,new Date(r.next_attempt_at.getTime()-1)).consume(c.eventId),{duplicate:true,effects:0});
      assert.equal((await receipt(c)).attempt_count,i);at=r.next_attempt_at;
    }
  }
  assert.equal((await receipt(c)).status,'dead');
  return at;
}
async function blocked(blockedPid,blocker) {
  for(let i=0;i<400;i++) {
    const [{ids}]=await control.query('SELECT pg_blocking_pids($1) ids',[blockedPid]);
    if(ids.includes(blocker))return;await delay(10);
  }
  throw new Error('Expected database lock was not observed.');
}
async function realQueue(c,dropBeforeClaim) {
  const name=`atlas-consumer-${randomUUID()}`;
  const connection={host:redis.hostname,port:Number(redis.port||6379),db:15,maxRetriesPerRequest:null};
  const config={get:key=>({SYSTEM_QUEUE_NAME:name,REDIS_URL:redis.href})[key]};
  const adapter=new BullMqEventingQueue(config), queue=new Queue(name,{connection});
  let worker;
  const awaitEvent=(object,event)=>new Promise((resolvePromise,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`Queue ${event} timeout`)),8000);
    object.once(event,(...args)=>{clearTimeout(timer);resolvePromise(args);});
  });
  try {
    if(!dropBeforeClaim) {
      worker=new Worker(name,async()=>{throw new Error('stopped before DB claim');},{connection});
      const failure=awaitEvent(worker,'failed');
      await adapter.enqueueOutboxEvent({eventId:c.eventId,availableAt:new Date(0)});
      await failure;await worker.close();worker=undefined;
      assert.equal(await (await queue.getJob(c.eventId)).getState(),'failed');
    } else {
      await adapter.enqueueOutboxEvent({eventId:c.eventId,availableAt:new Date(0)});
      await (await queue.getJob(c.eventId)).remove();
    }
    assert.equal(await receipt(c),undefined);
    const at=new Date(start.getTime()+31_000);
    const notifications=await tx(a,m=>repo.reserveConsumptionNotifications(at,new Date(start.getTime()-1),200,m));
    const n=notifications.find(x=>x.eventId===c.eventId);assert.ok(n);
    await adapter.enqueueOutboxEvent({...n,availableAt:new Date(0)});
    const jobId=`outbox-${c.eventId}-${n.notificationVersion}`;
    assert.ok(await queue.getJob(jobId));
    worker=new Worker(name,job=>consume(b,at).consume(job.data.eventId),{connection,concurrency:1});
    await awaitEvent(worker,'completed');
    await worker.close();worker=undefined;
    assert.equal((await receipt(c)).status,'succeeded');
    assert.equal((await receipt(c)).attempt_count,1);
    if(!dropBeforeClaim) assert.equal(await (await queue.getJob(c.eventId)).getState(),'failed');
  } finally {
    if(worker)await worker.close();
    await adapter.onApplicationShutdown();
    await queue.obliterate({force:true}); // Only the randomly named test-owned queue, never Redis-wide flush.
    await queue.close();
  }
}
try {
  await control.query(`CREATE SCHEMA "${schema}"`);ownsSchema=true;
  const dir=resolve(root,'packages/database/dist/migrations');
  const files=readdirSync(dir).filter(f=>/^\d+-.+\.js$/u.test(f)).sort();
  assert.ok(files.includes('1788672000000-AddConsumerRetryLifecycle.js'));
  const migrations=files.map(file=>{
    const classes=Object.values(require(resolve(dir,file))).filter(v=>typeof v==='function'&&v.prototype.up);
    assert.equal(classes.length,1);return new classes[0]();
  });
  for(const migration of migrations)await tx(control,()=>migration.up(control));
  const migration=migrations.find(m=>m.name==='AddConsumerRetryLifecycle1788672000000');
  await tx(control,()=>migration.down(control));await tx(control,()=>migration.up(control));
  await control.query(`INSERT INTO admin_accounts(id,email,display_name,password_hash,role,password_changed_at,created_at,updated_at) VALUES($1,'consumer@atlas.test','Fixture','$argon2id$fixture','owner',$2,$2,$2)`,[admin,start]);
  console.log(`Applied ${files.length} actual migrations; worker sessions ${pidA}/${pidB}`);
  await scenario('empty migration down/up succeeds',async()=>assert.ok(migration));
  await scenario('five durable attempts exhaust the budget; early and terminal hints cannot retry',async()=>{
    const c=await makeEvent();const at=await exhaust(c);
    const before=await receipt(c);
    assert.deepEqual(await consume(b,new Date(at.getTime()+3600000)).consume(c.eventId),{duplicate:true,effects:0});
    assert.deepEqual(await receipt(c),before);assert.equal((await attemptRows(c)).length,5);
  });
  await scenario('malformed persisted payload is quarantined after one counted attempt',async()=>{
    const c=await makeEvent(true);await assert.rejects(consume(a).consume(c.eventId),/contract rejected/);
    const r=await receipt(c);assert.equal(r.status,'dead');assert.equal(r.attempt_count,1);assert.equal(r.failure_code,'contract-rejected');
    assert.equal((await attemptRows(c)).length,1);
    await assert.rejects(context(c,()=>service(b).replayConsumption(c.workspaceId,{eventId:c.eventId,replayId:createUuidV7(),expectedAttempt:1,reason:'handler-upgraded'})),/contract rejected/);
  });
  await scenario('manual replay is audited once, preserves history, and never replays success',async()=>{
    const c=await makeEvent();const at=await exhaust(c);const old=await control.query('SELECT * FROM outbox_events WHERE id=$1',[c.eventId]);
    const input={eventId:c.eventId,replayId:createUuidV7(),expectedAttempt:5,reason:'dependency-restored'};
    const result=await context(c,()=>service(a,at).replayConsumption(c.workspaceId,input));assert.equal(result.attemptLimit,10);assert.equal(result.replayed,false);
    assert.equal((await context(c,()=>service(b,at).replayConsumption(c.workspaceId,input))).replayed,true);
    assert.equal((await receipt(c)).attempt_count,5);
    await consume(a,at).consume(c.eventId);assert.equal((await receipt(c)).attempt_count,6);assert.equal((await receipt(c)).status,'succeeded');
    assert.equal((await context(c,()=>service(b,at).replayConsumption(c.workspaceId,input))).replayed,true);
    await assert.rejects(context(c,()=>service(b,at).replayConsumption(c.workspaceId,{...input,replayId:createUuidV7(),expectedAttempt:6})),/Only dead/);
    assert.deepEqual(await control.query('SELECT * FROM outbox_events WHERE id=$1',[c.eventId]),old);
    assert.equal((await attemptRows(c)).length,6);
    const [{n}]=await control.query("SELECT count(*)::int n FROM audit_logs WHERE workspace_id=$1 AND action='outbox.consumption-replay-requested'",[c.workspaceId]);assert.equal(n,1);
  });
  await scenario('replay Audit failure rolls back the new budget, replay record and state',async()=>{
    const c=await makeEvent();const at=await exhaust(c);const before=await receipt(c);
    const fail=new AuditService({insert:async(r,m)=>{await auditRepo.insert(r,m);throw new Error('replay audit unavailable');}},new FixedClock(at));
    await assert.rejects(context(c,()=>service(a,at,fail).replayConsumption(c.workspaceId,{eventId:c.eventId,replayId:createUuidV7(),expectedAttempt:5,reason:'operator-reviewed'})),/audit unavailable/);
    assert.deepEqual(await receipt(c),before);
    const [{n}]=await control.query('SELECT count(*)::int n FROM event_consumption_replays WHERE consumption_id=$1',[before.id]);assert.equal(n,0);
  });
  await scenario('operator scope, expected attempt and unauthenticated replay fail closed',async()=>{
    const c=await makeEvent();await exhaust(c);const before=await receipt(c);
    await assert.rejects(context(c,()=>service(a).replayConsumption(c.workspaceId,{eventId:c.eventId,replayId:createUuidV7(),expectedAttempt:4,reason:'operator-reviewed'})),/attempt changed/);
    await assert.rejects(service(a).replayConsumption(c.workspaceId,{eventId:c.eventId,replayId:createUuidV7(),expectedAttempt:5,reason:'operator-reviewed'}));
    await assert.rejects(repo.consumptionHistory(createUuidV7(),c.eventId,50),/not found/);
    assert.deepEqual(await repo.listConsumptions(createUuidV7(),undefined,50),[]);assert.deepEqual(await receipt(c),before);
  });
  await scenario('repeated stale execution consumes the same bounded budget without resetting counters',async()=>{
    const c=await makeEvent();let at=start;let first;
    for(let i=1;i<=5;i++) {
      const r=await tx(a,m=>repo.claimEventConsumption(c.eventId,'atlas.eventing.v1',at,new Date(at.getTime()-30000),m));assert.ok(r);assert.equal(r.attemptCount,i);first??=r;
      at=new Date(at.getTime()+60000);
    }
    assert.equal(await tx(b,m=>repo.claimEventConsumption(c.eventId,'atlas.eventing.v1',at,new Date(at.getTime()-30000),m)),undefined);
    const before=await receipt(c);assert.equal(before.status,'dead');assert.equal(before.attempt_count,5);
    assert.equal(await tx(a,m=>repo.completeEventConsumption({consumptionId:first.id,eventId:c.eventId,consumerKey:'atlas.eventing.v1',workspaceId:c.workspaceId,attemptNumber:1},'succeeded',{processedAt:at},m)),false);
    assert.deepEqual(await receipt(c),before);assert.equal((await attemptRows(c)).length,5);
  });
  await scenario('actual concurrent claims serialize to one owner',async()=>{
    const c=await makeEvent();await a.startTransaction();
    const first=await repo.claimEventConsumption(c.eventId,'atlas.eventing.v1',start,new Date(0),a.manager);assert.ok(first);
    const other=tx(b,m=>repo.claimEventConsumption(c.eventId,'atlas.eventing.v1',start,new Date(0),m));void other.catch(()=>{});
    try {await blocked(pidB,pidA);}finally{await a.commitTransaction();}
    assert.equal(await other,undefined);
    await tx(a,m=>repo.completeEventConsumption({consumptionId:first.id,eventId:c.eventId,consumerKey:first.consumerKey,workspaceId:c.workspaceId,attemptNumber:1},'succeeded',{processedAt:start},m));
  });
  await scenario('notification lease prevents hot-looping and generation advances after missed hints',async()=>{
    const c=await makeEvent();const at=new Date(start.getTime()+60000);
    const one=(await tx(a,m=>repo.reserveConsumptionNotifications(at,start,200,m))).find(n=>n.eventId===c.eventId);assert.ok(one);
    assert.equal((await tx(b,m=>repo.reserveConsumptionNotifications(at,start,200,m))).some(n=>n.eventId===c.eventId),false);
    const next=(await tx(b,m=>repo.reserveConsumptionNotifications(new Date(at.getTime()+31000),start,200,m))).find(n=>n.eventId===c.eventId);
    assert.ok(next);assert.equal(next.notificationVersion,one.notificationVersion+1);assert.equal((await receipt(c)).attempt_count,0);
  });
  await scenario('real BullMQ retained failed Job does not block DB reconciliation',async()=>realQueue(await makeEvent(),false));
  await scenario('real BullMQ missing Job is recovered without erasing receipts or Redis data',async()=>realQueue(await makeEvent(),true));
  await scenario('safe read views omit payload, raw errors and actor secrets',async()=>{
    const c=await makeEvent();await consume(a).consume(c.eventId);
    const views=await service(a).listConsumptions(c.workspaceId);assert.equal(views.length,1);
    assert.equal('payload' in views[0],false);assert.equal('lastError' in views[0],false);
    const h=await service(a).consumptionHistory(c.workspaceId,c.eventId);assert.equal(h.attempts.length,1);
  });
  await scenario('terminal evidence, successful receipts and unsafe rollback are protected',async()=>{
    const c=await makeEvent();await consume(a).consume(c.eventId);const r=await receipt(c);
    for(const sql of ["UPDATE event_consumptions SET status='pending',next_attempt_at=now(),processed_at=NULL WHERE id=$1",
      'UPDATE event_consumption_attempts SET outcome=outcome WHERE consumption_id=$1',
      'DELETE FROM event_consumption_attempts WHERE consumption_id=$1'])await assert.rejects(tx(a,m=>m.query(sql,[r.id])));
    await assert.rejects(tx(control,()=>migration.down(control)),/destructive rollback/);
  });
  assert.equal(passed,13);
  console.log(JSON.stringify({result:'success',scenarios:passed,migrations:files.length,redis:'real-BullMQ-isolated-queue'}));
} finally {
  for(const c of [a,b,control])if(c.isTransactionActive)await c.rollbackTransaction();
  await Promise.all([a.release(),b.release()]);
  if(ownsSchema)await control.query(`DROP SCHEMA "${schema}" CASCADE`);
  await control.release();await ds.destroy();
}
