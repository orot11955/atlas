import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ActorType,
  AdminAccountStatus,
  AdminPermission,
  AdminRole,
  Argon2idPasswordHasher,
  AuditService,
  BootstrapOwnerService,
  DomainError,
  ErrorCode,
  FixedClock,
  hasAdminPermission,
  requestContext,
  type AdminAccountRepositoryPort,
  type AuditRecord,
  type AuditRepositoryPort,
  type InsertAdminAccountRecord,
  type PasswordHasher,
  type TransactionRunner,
} from './index';

type TestTransaction = Readonly<{ id: 'test-transaction' }>;

class TestTransactionRunner implements TransactionRunner<TestTransaction> {
  public readonly transaction: TestTransaction = Object.freeze({ id: 'test-transaction' });

  public run<TResult>(work: (transaction: TestTransaction) => Promise<TResult>): Promise<TResult> {
    return work(this.transaction);
  }
}

class MemoryAdminAccountRepository implements AdminAccountRepositoryPort<TestTransaction> {
  public readonly accounts: InsertAdminAccountRecord[] = [];
  public lockCount = 0;
  public ownerExists = false;

  public async acquireOwnerBootstrapLock(transaction: TestTransaction): Promise<void> {
    assert.equal(transaction.id, 'test-transaction');
    this.lockCount += 1;
  }

  public async existsByEmail(email: string, _transaction?: TestTransaction): Promise<boolean> {
    return this.accounts.some((account) => account.email === email);
  }

  public async existsByRole(role: AdminRole, _transaction?: TestTransaction): Promise<boolean> {
    return this.ownerExists || this.accounts.some((account) => account.role === role);
  }

  public async insert(
    account: InsertAdminAccountRecord,
    _transaction?: TestTransaction,
  ): Promise<void> {
    this.accounts.push({ ...account });
  }
}

class MemoryAuditRepository implements AuditRepositoryPort<TestTransaction> {
  public readonly records: AuditRecord[] = [];

  public async insert(record: AuditRecord, transaction?: TestTransaction): Promise<void> {
    assert.equal(transaction?.id, 'test-transaction');
    this.records.push({ ...record });
  }
}

class RecordingPasswordHasher implements PasswordHasher {
  public readonly values: string[] = [];

  public async hash(password: string): Promise<string> {
    this.values.push(password);
    return '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$ZGlnZXN0ZGlnZXN0ZGlnZXN0ZGlnZXN0ZGlnZXN0ZGlnZXN0';
  }

  public async verify(_encodedHash: string, _password: string): Promise<boolean> {
    return false;
  }
}

test('Role registry grants OWNER every permission and keeps VIEWER read-only', () => {
  assert.equal(hasAdminPermission(AdminRole.OWNER, AdminPermission.SECURITY_MANAGE), true);
  assert.equal(hasAdminPermission(AdminRole.OWNER, AdminPermission.DEPLOYMENTS_CONTROL), true);
  assert.equal(hasAdminPermission(AdminRole.VIEWER, AdminPermission.PROJECTS_READ), true);
  assert.equal(hasAdminPermission(AdminRole.VIEWER, AdminPermission.PROJECTS_MANAGE), false);
});

test('Argon2idPasswordHasher stores a PHC string and verifies without exposing the password', async () => {
  const hasher = new Argon2idPasswordHasher();
  const password = 'correct horse battery staple';
  const encodedHash = await hasher.hash(password);

  assert.match(encodedHash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/u);
  assert.equal(encodedHash.includes(password), false);
  assert.equal(await hasher.verify(encodedHash, password), true);
  assert.equal(await hasher.verify(encodedHash, 'incorrect password'), false);
  assert.equal(await hasher.verify('not-a-password-hash', password), false);
});

test('BootstrapOwnerService creates one canonical OWNER account and records a safe audit event', async () => {
  const transactionRunner = new TestTransactionRunner();
  const adminAccounts = new MemoryAdminAccountRepository();
  const auditRepository = new MemoryAuditRepository();
  const passwordHasher = new RecordingPasswordHasher();
  const clock = new FixedClock('2026-08-29T12:00:00.000Z');
  const service = new BootstrapOwnerService(
    transactionRunner,
    adminAccounts,
    passwordHasher,
    new AuditService(auditRepository, clock),
    clock,
  );

  const result = await requestContext.run(
    {
      requestId: 'bootstrap-request',
      traceId: 'bootstrap-trace',
      actorType: ActorType.SYSTEM,
      actorId: 'system:owner-bootstrap',
    },
    () =>
      service.execute({
        email: '  Owner@Example.COM ',
        displayName: ' Atlas Owner ',
        password: 'correct horse battery staple',
      }),
  );

  assert.equal(adminAccounts.lockCount, 1);
  assert.equal(adminAccounts.accounts.length, 1);
  assert.equal(adminAccounts.accounts[0]?.email, 'owner@example.com');
  assert.equal(adminAccounts.accounts[0]?.displayName, 'Atlas Owner');
  assert.equal(adminAccounts.accounts[0]?.role, AdminRole.OWNER);
  assert.equal(adminAccounts.accounts[0]?.status, AdminAccountStatus.ACTIVE);
  assert.equal(adminAccounts.accounts[0]?.passwordHash.includes('correct horse'), false);
  assert.deepEqual(passwordHasher.values, ['correct horse battery staple']);
  assert.equal(result.email, 'owner@example.com');
  assert.equal(result.role, AdminRole.OWNER);

  assert.equal(auditRepository.records.length, 1);
  assert.equal(auditRepository.records[0]?.action, 'admin.owner.bootstrapped');
  assert.equal(auditRepository.records[0]?.targetId, result.id);
  assert.equal(auditRepository.records[0]?.actorType, ActorType.SYSTEM);
  assert.deepEqual(auditRepository.records[0]?.metadata, {
    role: AdminRole.OWNER,
    source: 'owner-bootstrap-cli',
  });
  assert.equal(JSON.stringify(auditRepository.records[0]).includes('owner@example.com'), false);
  assert.equal(
    JSON.stringify(auditRepository.records[0]).includes('correct horse battery staple'),
    false,
  );
});

test('BootstrapOwnerService rejects a second OWNER after taking the bootstrap lock', async () => {
  const transactionRunner = new TestTransactionRunner();
  const adminAccounts = new MemoryAdminAccountRepository();
  adminAccounts.ownerExists = true;
  const auditRepository = new MemoryAuditRepository();
  const clock = new FixedClock('2026-08-29T12:00:00.000Z');
  const service = new BootstrapOwnerService(
    transactionRunner,
    adminAccounts,
    new RecordingPasswordHasher(),
    new AuditService(auditRepository, clock),
    clock,
  );

  await requestContext.run(
    {
      requestId: 'bootstrap-request-2',
      traceId: 'bootstrap-trace-2',
      actorType: ActorType.SYSTEM,
      actorId: 'system:owner-bootstrap',
    },
    async () => {
      await assert.rejects(
        service.execute({
          email: 'second-owner@example.com',
          password: 'correct horse battery staple',
        }),
        (error: unknown) => {
          assert.equal(error instanceof DomainError, true);
          assert.equal((error as DomainError).code, ErrorCode.ADMIN_OWNER_ALREADY_EXISTS);
          return true;
        },
      );
    },
  );

  assert.equal(adminAccounts.lockCount, 1);
  assert.equal(adminAccounts.accounts.length, 0);
  assert.equal(auditRepository.records.length, 0);
});
