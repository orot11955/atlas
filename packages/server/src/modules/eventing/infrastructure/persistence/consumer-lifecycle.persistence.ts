import type { EntityManager } from 'typeorm';
import { createUuidV7, DomainError, ErrorCode, isUuidV7 } from '../../../../core';
import type { EventConsumptionRecord } from '../../domain/eventing';
import type { EventConsumptionOwner } from '../../ports/eventing-attempt-owner';
import {
  CONSUMER_ATTEMPTS_PER_CYCLE, CONSUMER_KEY, CONSUMER_NOTIFICATION_LEASE_MS,
  retryDelay, type ConsumerState, type ConsumptionCompletion, type ConsumptionNotification,
  type ConsumptionReplayInput, type ConsumptionReplayResult, type ConsumptionView,
} from '../../ports/consumer-lifecycle';
import { requireEventingTransaction } from './eventing-attempt.persistence';
import { unwrapTypeOrmMutationRows } from './typeorm-mutation-result';

type Row = {
  id: string; event_id: string; consumer_key: string; workspace_id: string;
  status: ConsumerState; attempt_count: number; attempt_limit: number; cycle_start_attempt: number;
  claimed_at: Date; processed_at: Date | null; next_attempt_at: Date | null;
  notification_version: number; failure_code: string | null;
  result_json: Record<string, unknown> | null; last_error: string | null;
  created_at: Date; updated_at: Date;
};
function uuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !isUuidV7(value)) throw new Error('A valid Consumer identity is required.');
}
function instant(at: Date): void {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new Error('A valid Consumer timestamp is required.');
}
function ownerIdentity(owner: Readonly<EventConsumptionOwner>): void {
  if (!owner) throw new Error('A Consumer owner is required.');
  uuid(owner.consumptionId); uuid(owner.eventId); uuid(owner.workspaceId);
  key(owner.consumerKey);
  if (!Number.isSafeInteger(owner.attemptNumber) || owner.attemptNumber < 1) throw new Error('A positive Consumer attempt is required.');
}
function key(value: string): void {
  if (typeof value !== 'string' || value.length > 120 || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(value)) throw new Error('A valid Consumer key is required.');
}
function limitSize(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Consumer batch limit must be 1..200.');
}
function singleton(result: unknown): boolean {
  const rows = unwrapTypeOrmMutationRows<{ id: string }>(result);
  if (rows.length > 1 || rows.some((row) => typeof row.id !== 'string')) throw new Error('Invalid Consumer mutation result.');
  return rows.length === 1;
}
async function history(row: Row, outcome: string, code: string | null, at: Date, tx: EntityManager): Promise<void> {
  // No ON CONFLICT: a second terminal record for one attempt is corruption, not success.
  await tx.query(`INSERT INTO event_consumption_attempts
    (consumption_id,attempt_number,cycle_start_attempt,outcome,failure_code,started_at,finished_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`,
  [row.id,row.attempt_count,row.cycle_start_attempt,outcome,code,row.claimed_at,at]);
}
async function expire(row: Row, at: Date, tx: EntityManager): Promise<void> {
  const dead = row.attempt_count >= row.attempt_limit;
  await history(row, dead ? 'dead' : 'abandoned', 'claim-expired', at, tx);
  await tx.query(`UPDATE event_consumptions SET status=$2, processed_at=$3, next_attempt_at=$4,
    result_json=NULL, failure_code='claim-expired', last_error='Consumer claim expired.', notify_after=$3, updated_at=$3
    WHERE id=$1`, [row.id,dead ? 'dead' : 'failed',at,dead ? null : at]);
  row.status = dead ? 'dead' : 'failed'; row.processed_at=at; row.next_attempt_at=dead ? null : at;
}

export async function claimConsumption(
  eventId: string, consumerKey: string, at: Date, staleBefore: Date, tx: EntityManager,
): Promise<EventConsumptionRecord | undefined> {
  requireEventingTransaction(tx); uuid(eventId); key(consumerKey); instant(at); instant(staleBefore);
  await tx.query(`INSERT INTO event_consumptions
    (id,consumer_key,event_id,status,attempt_count,claimed_at,created_at,updated_at,next_attempt_at)
    SELECT $1,$2,id,'pending',0,$4,$4,$4,$4 FROM outbox_events
    WHERE id=$3 AND status IN ('processing','dispatched')
    ON CONFLICT (consumer_key,event_id) DO NOTHING`,[createUuidV7(at.getTime()),consumerKey,eventId,at]);
  const rows: Row[] = await tx.query(`SELECT c.*,e.workspace_id FROM event_consumptions c
    JOIN outbox_events e ON e.id=c.event_id WHERE c.consumer_key=$1 AND c.event_id=$2
    AND e.status IN ('processing','dispatched') FOR UPDATE OF c`,[consumerKey,eventId]);
  const row=rows[0];
  if (!row || row.status==='succeeded' || row.status==='dead') return undefined;
  if (row.status==='processing') {
    if (row.claimed_at.getTime() >= staleBefore.getTime()) return undefined;
    await expire(row,at,tx);
    if (row.attempt_count >= row.attempt_limit) return undefined;
  }
  if (!row.next_attempt_at || row.next_attempt_at > at || row.attempt_count >= row.attempt_limit) return undefined;
  const result=await tx.query(`UPDATE event_consumptions SET status='processing',attempt_count=attempt_count+1,
    claimed_at=$2,processed_at=NULL,next_attempt_at=NULL,result_json=NULL,last_error=NULL,failure_code=NULL,
    notify_after=$2,updated_at=$2 WHERE id=$1 RETURNING *`,[row.id,at]);
  const claimed=unwrapTypeOrmMutationRows<Row>(result);
  if (claimed.length!==1) throw new Error('Consumer claim did not return one row.');
  const r=claimed[0]!;
  return { id:r.id,eventId:r.event_id,consumerKey:r.consumer_key,status:'processing',attemptCount:r.attempt_count,
    claimedAt:new Date(r.claimed_at),createdAt:new Date(r.created_at),updatedAt:new Date(r.updated_at) };
}

export async function finishDurableConsumption(
  owner: Readonly<EventConsumptionOwner>, status:'succeeded'|'failed', input:Readonly<ConsumptionCompletion>, tx:EntityManager,
):Promise<boolean> {
  requireEventingTransaction(tx); ownerIdentity(owner); instant(input.processedAt);
  if (!['succeeded','failed'].includes(status)) throw new Error('Invalid Consumer result.');
  const rows:Row[]=await tx.query(`SELECT c.*,e.workspace_id FROM event_consumptions c JOIN outbox_events e ON e.id=c.event_id
    WHERE c.id=$1 AND c.event_id=$2 AND c.consumer_key=$3 AND c.attempt_count=$4 AND e.workspace_id=$5
      AND c.status='processing' FOR UPDATE OF c`,[owner.consumptionId,owner.eventId,owner.consumerKey,owner.attemptNumber,owner.workspaceId]);
  const row=rows[0]; if(!row) return false;
  const terminal=status==='failed' && (input.permanentFailure===true || row.attempt_count>=row.attempt_limit);
  const next=status==='failed' && !terminal ? new Date(input.processedAt.getTime()+retryDelay(row.attempt_count,row.cycle_start_attempt)) : null;
  const code=status==='succeeded' ? null : input.permanentFailure ? 'contract-rejected' : terminal ? 'attempts-exhausted' : 'processing-failed';
  const state=terminal ? 'dead' : status;
  const changed=singleton(await tx.query(`UPDATE event_consumptions SET status=$2,processed_at=$3,next_attempt_at=$4,
    result_json=$5,last_error=$6,failure_code=$7,notify_after=$3,updated_at=$3 WHERE id=$1 RETURNING id`,
    [row.id,state,input.processedAt,next,status==='succeeded' ? input.result ?? null : null,
      status==='succeeded' ? null : 'Consumer processing failed; inspect failure code and correlated logs.',code]));
  if(!changed) throw new Error('Locked Consumer state changed unexpectedly.');
  await history(row,state,code,input.processedAt,tx);
  return true;
}

export async function reserveNotifications(now:Date,staleBefore:Date,limit:number,tx:EntityManager):Promise<readonly ConsumptionNotification[]> {
  requireEventingTransaction(tx);instant(now);instant(staleBefore);limitSize(limit);
  const missedBefore=new Date(now.getTime()-CONSUMER_NOTIFICATION_LEASE_MS);
  // Initial enqueue may have been lost before a receipt was ever claimed. Serialize
  // missing-receipt creation on Outbox rows, without changing their delivery status.
  const missing: {id:string}[]=await tx.query(`SELECT e.id FROM outbox_events e
    WHERE e.status='dispatched' AND e.dispatched_at <= $1
    AND NOT EXISTS (SELECT 1 FROM event_consumptions c WHERE c.event_id=e.id AND c.consumer_key=$2)
    ORDER BY e.dispatched_at,e.id FOR UPDATE OF e SKIP LOCKED LIMIT $3`,[missedBefore,CONSUMER_KEY,limit]);
  for(const e of missing) {
    await tx.query(`INSERT INTO event_consumptions
      (id,consumer_key,event_id,status,attempt_count,claimed_at,created_at,updated_at,next_attempt_at)
      VALUES($1,$2,$3,'pending',0,$4,$4,$4,$4) ON CONFLICT(consumer_key,event_id) DO NOTHING`,
      [createUuidV7(now.getTime()),CONSUMER_KEY,e.id,now]);
  }
  const rows:Row[]=await tx.query(`SELECT c.*,e.workspace_id FROM event_consumptions c JOIN outbox_events e ON e.id=c.event_id
    WHERE c.consumer_key=$1 AND e.status IN ('processing','dispatched') AND c.notify_after <= $2
      AND ((c.status IN ('pending','failed') AND c.next_attempt_at <= $2) OR (c.status='processing' AND c.claimed_at < $3))
    ORDER BY COALESCE(c.next_attempt_at,c.claimed_at),c.id FOR UPDATE OF c SKIP LOCKED LIMIT $4`,[CONSUMER_KEY,now,staleBefore,limit]);
  const notifications:ConsumptionNotification[]=[];
  for(const row of rows) {
    if(row.status==='processing') await expire(row,now,tx);
    if(row.status==='dead') continue;
    const result=unwrapTypeOrmMutationRows<{id:string;notification_version:number}>(await tx.query(`UPDATE event_consumptions
      SET notification_version=notification_version+1,notify_after=$2 WHERE id=$1 RETURNING id,notification_version`,
      [row.id,new Date(now.getTime()+CONSUMER_NOTIFICATION_LEASE_MS)]));
    if(result.length!==1) throw new Error('Consumer notification lease was not reserved.');
    notifications.push({eventId:row.event_id,notificationVersion:result[0]!.notification_version,availableAt:now});
  }
  return notifications;
}

export async function listConsumptions(workspaceId:string,status:ConsumerState|undefined,limit:number,tx:EntityManager):Promise<readonly ConsumptionView[]> {
  uuid(workspaceId);limitSize(limit);
  if(status!==undefined && !['pending','processing','failed','dead','succeeded'].includes(status)) throw new Error('Invalid Consumer status.');
  const rows:Row[]=await tx.query(`SELECT c.* FROM event_consumptions c JOIN outbox_events e ON e.id=c.event_id
    WHERE e.workspace_id=$1 AND c.consumer_key=$2 AND ($3::text IS NULL OR c.status=$3)
    ORDER BY c.updated_at DESC,c.id DESC LIMIT $4`,[workspaceId,CONSUMER_KEY,status??null,limit]);
  return rows.map(r=>({id:r.id,eventId:r.event_id,consumerKey:r.consumer_key,status:r.status,attemptCount:r.attempt_count,
    attemptLimit:r.attempt_limit,cycleStartAttempt:r.cycle_start_attempt,nextAttemptAt:r.next_attempt_at,
    failureCode:r.failure_code,updatedAt:r.updated_at}));
}

export async function readHistory(workspaceId:string,eventId:string,limit:number,tx:EntityManager) {
  uuid(workspaceId);uuid(eventId);limitSize(limit);
  const rows:{id:string}[]=await tx.query(`SELECT c.id FROM event_consumptions c JOIN outbox_events e ON e.id=c.event_id
    WHERE e.workspace_id=$1 AND c.event_id=$2 AND c.consumer_key=$3`,[workspaceId,eventId,CONSUMER_KEY]);
  if(!rows[0]) throw new DomainError({code:ErrorCode.NOT_FOUND,message:'Consumer receipt was not found.'});
  const attempts:Record<string,unknown>[]=await tx.query(`SELECT attempt_number,cycle_start_attempt,outcome,failure_code,started_at,finished_at
    FROM event_consumption_attempts WHERE consumption_id=$1 ORDER BY attempt_number DESC LIMIT $2`,[rows[0].id,limit]);
  const replays:Record<string,unknown>[]=await tx.query(`SELECT id,previous_attempt,previous_limit,next_limit,reason,created_at
    FROM event_consumption_replays WHERE consumption_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2`,[rows[0].id,limit]);
  return {attempts,replays};
}

export async function replayConsumption(workspaceId:string,actorId:string,input:Readonly<ConsumptionReplayInput>,at:Date,tx:EntityManager):Promise<ConsumptionReplayResult> {
  requireEventingTransaction(tx);uuid(workspaceId);uuid(actorId);uuid(input.eventId);uuid(input.replayId);instant(at);
  if(!Number.isSafeInteger(input.expectedAttempt)||input.expectedAttempt<1||
    !['dependency-restored','handler-upgraded','operator-reviewed'].includes(input.reason)) throw new DomainError({code:ErrorCode.VALIDATION_FAILED,message:'Invalid Consumer replay request.'});
  const rows:Row[]=await tx.query(`SELECT c.*,e.workspace_id FROM event_consumptions c JOIN outbox_events e ON e.id=c.event_id
    WHERE c.event_id=$1 AND c.consumer_key=$2 AND e.workspace_id=$3 FOR UPDATE OF c`,[input.eventId,CONSUMER_KEY,workspaceId]);
  const row=rows[0];if(!row) throw new DomainError({code:ErrorCode.NOT_FOUND,message:'Consumer receipt was not found.'});
  const prior=await tx.query(`SELECT * FROM event_consumption_replays WHERE id=$1`,[input.replayId]);
  if(prior[0]) {
    const p=prior[0];
    if(p.consumption_id!==row.id||p.previous_attempt!==input.expectedAttempt||p.reason!==input.reason||p.requested_by_admin_account_id!==actorId)
      throw new DomainError({code:ErrorCode.VERSION_CONFLICT,message:'Replay ID was already used for another request.'});
    return {replayId:input.replayId,eventId:row.event_id,previousAttempt:p.previous_attempt,attemptLimit:p.next_limit,replayed:true};
  }
  if(row.status!=='dead') throw new DomainError({code:ErrorCode.INVALID_STATE_TRANSITION,message:'Only dead Consumer receipts may be replayed.'});
  if(row.attempt_count!==input.expectedAttempt) throw new DomainError({code:ErrorCode.VERSION_CONFLICT,message:'Consumer attempt changed; refresh before replay.'});
  if(row.attempt_count>2_147_483_642) throw new Error('Consumer attempt counter exhausted.');
  const attemptLimit=row.attempt_count+CONSUMER_ATTEMPTS_PER_CYCLE;
  const inserted=singleton(await tx.query(`INSERT INTO event_consumption_replays
    (id,consumption_id,requested_by_admin_account_id,previous_attempt,previous_limit,next_limit,reason,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING RETURNING id`,[input.replayId,row.id,actorId,row.attempt_count,row.attempt_limit,attemptLimit,input.reason,at]));
  if (!inserted) throw new DomainError({code:ErrorCode.VERSION_CONFLICT,message:'Replay ID was already used for another request.'});
  await tx.query(`UPDATE event_consumptions SET status='pending',cycle_start_attempt=attempt_count,attempt_limit=$2,
    next_attempt_at=$3,processed_at=NULL,result_json=NULL,last_error=NULL,failure_code=NULL,notify_after=$3,updated_at=$3 WHERE id=$1`,[row.id,attemptLimit,at]);
  return {replayId:input.replayId,eventId:row.event_id,previousAttempt:row.attempt_count,attemptLimit,replayed:false};
}
