import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ActorType,
  ApplicationError,
  AuditResult,
  AuditService,
  ErrorCode,
  FixedClock,
  REDACTED_AUDIT_VALUE,
  RequestContextStore,
  isUuidV7,
  type AuditRecord,
  type AuditRepositoryPort,
} from './index';

class InMemoryAuditRepository implements AuditRepositoryPort<string> {
  public readonly records: AuditRecord[] = [];
  public readonly transactions: Array<string | undefined> = [];

  public async insert(record: AuditRecord, transaction?: string): Promise<void> {
    this.records.push(record);
    this.transactions.push(transaction);
  }
}

test('AuditService records context, transaction and redacted metadata', async () => {
  const repository = new InMemoryAuditRepository();
  const contextStore = new RequestContextStore();
  const clock = new FixedClock('2026-08-29T10:45:00.000Z');
  const service = new AuditService(repository, clock, contextStore);

  const record = await contextStore.run(
    {
      requestId: 'request-1',
      traceId: 'trace-1',
      correlationId: 'deploy-42',
      actorType: ActorType.ADMIN,
      actorId: 'admin-1',
      workspaceId: '01992e16-3fc0-7000-8000-000000000001',
      siteId: '01992e16-3fc0-7000-8000-000000000002',
    },
    () =>
      service.record(
        {
          action: 'auth.login',
          targetType: 'admin-account',
          targetId: 'admin-1',
          result: AuditResult.SUCCESS,
          metadata: {
            method: 'password',
            password: 'never-store-this',
            nested: {
              accessToken: 'never-store-this-either',
            },
          },
        },
        'transaction-1',
      ),
  );

  assert.equal(isUuidV7(record.id), true);
  assert.equal(record.requestId, 'request-1');
  assert.equal(record.actorType, ActorType.ADMIN);
  assert.equal(record.workspaceId, '01992e16-3fc0-7000-8000-000000000001');
  assert.equal(record.occurredAt.toISOString(), '2026-08-29T10:45:00.000Z');
  assert.equal(record.metadata.password, REDACTED_AUDIT_VALUE);
  assert.deepEqual(record.metadata.nested, {
    accessToken: REDACTED_AUDIT_VALUE,
  });
  assert.equal(repository.records.length, 1);
  assert.deepEqual(repository.transactions, ['transaction-1']);
});

test('AuditService rejects invalid audit keys before persistence', async () => {
  const repository = new InMemoryAuditRepository();
  const contextStore = new RequestContextStore();
  const service = new AuditService(repository, new FixedClock(0), contextStore);

  await assert.rejects(
    contextStore.run(
      {
        requestId: 'request-1',
        traceId: 'trace-1',
        actorType: ActorType.SYSTEM,
      },
      () =>
        service.record({
          action: 'Invalid Audit Action',
          targetType: 'system',
        }),
    ),
    (error: unknown) => {
      assert.equal(error instanceof ApplicationError, true);
      assert.equal((error as ApplicationError).code, ErrorCode.VALIDATION_FAILED);
      return true;
    },
  );

  assert.equal(repository.records.length, 0);
});
