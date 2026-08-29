import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import {
  ActorType,
  AdminAccountStatus,
  AdminRole,
  AdminSessionRevokeReason,
  AdminSessionService,
  AuditService,
  DomainError,
  ErrorCode,
  FixedClock,
  Sha256AdminAuthenticationGrantTokenIssuer,
  Sha256AdminSessionTokenIssuer,
  requestContext,
  type AdminSessionAccount,
  type AdminSessionAuthenticationGrant,
  type CreateAdminSessionResult,
  type AdminSessionRecord,
  type AdminSessionRepositoryPort,
  type AuditRecord,
  type AuditRepositoryPort,
  type InsertAdminSessionRecord,
  type TouchAdminSessionInput,
  type TransactionRunner,
} from './index';

type TestTransaction = Readonly<{ id: 'session-transaction' }>;

class TestTransactionRunner implements TransactionRunner<TestTransaction> {
  private readonly transaction: TestTransaction = Object.freeze({
    id: 'session-transaction',
  });

  public run<TResult>(work: (transaction: TestTransaction) => Promise<TResult>): Promise<TResult> {
    return work(this.transaction);
  }
}

class MemorySessionRepository implements AdminSessionRepositoryPort<TestTransaction> {
  public readonly grants = new Map<string, AdminSessionAuthenticationGrant>();
  public readonly accounts = new Map<string, AdminSessionAccount>();
  public readonly sessions = new Map<string, AdminSessionRecord>();

  public async findGrantForUpdate(
    grantId: string,
    _transaction: TestTransaction,
  ): Promise<AdminSessionAuthenticationGrant | undefined> {
    return cloneGrant(this.grants.get(grantId));
  }

  public async consumeGrant(
    grantId: string,
    consumedAt: Date,
    _transaction: TestTransaction,
  ): Promise<void> {
    const grant = this.grants.get(grantId);
    if (!grant) {
      throw new Error('Grant missing in test repository.');
    }
    this.grants.set(grantId, { ...grant, consumedAt: new Date(consumedAt) });
  }

  public async findAccountForSession(
    accountId: string,
    _transaction?: TestTransaction,
  ): Promise<AdminSessionAccount | undefined> {
    const account = this.accounts.get(accountId);
    return account
      ? { ...account, passwordChangedAt: new Date(account.passwordChangedAt) }
      : undefined;
  }

  public async insertSession(
    session: InsertAdminSessionRecord,
    _transaction: TestTransaction,
  ): Promise<void> {
    this.sessions.set(session.id, cloneSession(session));
  }

  public async findSessionForUpdate(
    sessionId: string,
    _transaction: TestTransaction,
  ): Promise<AdminSessionRecord | undefined> {
    return cloneSession(this.sessions.get(sessionId));
  }

  public async touchSession(
    sessionId: string,
    input: TouchAdminSessionInput,
    _transaction: TestTransaction,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session missing in test repository.');
    }
    this.sessions.set(sessionId, {
      ...session,
      lastSeenAt: new Date(input.lastSeenAt),
      idleExpiresAt: new Date(input.idleExpiresAt),
    });
  }

  public async revokeSession(
    sessionId: string,
    revokedAt: Date,
    reason: AdminSessionRevokeReason,
    _transaction: TestTransaction,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.revokedAt) {
      return;
    }
    this.sessions.set(sessionId, {
      ...session,
      revokedAt: new Date(revokedAt),
      revokeReason: reason,
    });
  }

  public async listSessionsForAccount(accountId: string): Promise<readonly AdminSessionRecord[]> {
    return [...this.sessions.values()]
      .filter((session) => session.adminAccountId === accountId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map(cloneSession);
  }

  public async revokeOldestActiveSessions(
    accountId: string,
    keepCount: number,
    revokedAt: Date,
    _transaction: TestTransaction,
  ): Promise<number> {
    const active = [...this.sessions.values()]
      .filter(
        (session) =>
          session.adminAccountId === accountId &&
          !session.revokedAt &&
          session.idleExpiresAt > revokedAt &&
          session.absoluteExpiresAt > revokedAt,
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    const revoke = active.slice(keepCount);

    for (const session of revoke) {
      await this.revokeSession(
        session.id,
        revokedAt,
        AdminSessionRevokeReason.MAX_ACTIVE_SESSIONS,
        this.fakeTransaction(),
      );
    }
    return revoke.length;
  }

  public async revokeOtherActiveSessions(
    accountId: string,
    currentSessionId: string,
    revokedAt: Date,
    _transaction: TestTransaction,
  ): Promise<number> {
    const targets = [...this.sessions.values()].filter(
      (session) =>
        session.adminAccountId === accountId &&
        session.id !== currentSessionId &&
        !session.revokedAt &&
        session.idleExpiresAt > revokedAt &&
        session.absoluteExpiresAt > revokedAt,
    );
    for (const session of targets) {
      await this.revokeSession(
        session.id,
        revokedAt,
        AdminSessionRevokeReason.OTHER_SESSION_REVOKED,
        this.fakeTransaction(),
      );
    }
    return targets.length;
  }

  private fakeTransaction(): TestTransaction {
    return { id: 'session-transaction' };
  }
}

class MemoryAuditRepository implements AuditRepositoryPort<TestTransaction> {
  public readonly records: AuditRecord[] = [];

  public async insert(record: AuditRecord): Promise<void> {
    this.records.push({ ...record });
  }
}

const clock = new FixedClock('2026-08-30T00:00:00.000Z');
const loginPepper = 'atlas-test-login-fingerprint-pepper';
const sessionPepper = 'atlas-test-session-fingerprint-pepper';

function createHarness() {
  const repository = new MemorySessionRepository();
  const auditRepository = new MemoryAuditRepository();
  const grantIssuer = new Sha256AdminAuthenticationGrantTokenIssuer();
  const sessionIssuer = new Sha256AdminSessionTokenIssuer();
  const service = new AdminSessionService(
    new TestTransactionRunner(),
    repository,
    grantIssuer,
    sessionIssuer,
    new AuditService(auditRepository, clock),
    loginPepper,
    sessionPepper,
    {
      idleTtlMs: 30 * 60 * 1_000,
      absoluteTtlMs: 12 * 60 * 60 * 1_000,
      touchIntervalMs: 60 * 1_000,
      maximumActiveSessions: 2,
      bindClientAddress: false,
    },
    clock,
  );
  return { repository, auditRepository, grantIssuer, service };
}

async function runInRequest<TResult>(work: () => Promise<TResult>): Promise<TResult> {
  return requestContext.run(
    {
      requestId: 'session-request',
      traceId: 'session-trace',
      actorType: ActorType.ANONYMOUS,
    },
    work,
  );
}

test('one-time authentication grant creates a digested administrator session', async () => {
  const harness = createHarness();
  const accountId = '0199-0000-7000-8000-000000000001';
  const issuedGrant = harness.grantIssuer.issue(clock.now());
  harness.repository.accounts.set(accountId, {
    id: accountId,
    role: AdminRole.OWNER,
    status: AdminAccountStatus.ACTIVE,
    passwordChangedAt: new Date('2026-08-29T00:00:00.000Z'),
  });
  harness.repository.grants.set(issuedGrant.id, {
    id: issuedGrant.id,
    adminAccountId: accountId,
    tokenDigest: issuedGrant.tokenDigest,
    ipFingerprint: fingerprintLoginAddress('127.0.0.1'),
    expiresAt: new Date(clock.now().getTime() + 120_000),
  });

  const created = await runInRequest(() =>
    harness.service.createSession({
      grantId: issuedGrant.id,
      grantToken: issuedGrant.token,
      clientAddress: '127.0.0.1',
      userAgent: 'Atlas Test Browser',
    }),
  );

  assert.match(created.sessionToken, /^atlas_session_/u);
  assert.match(created.csrfToken, /^atlas_csrf_/u);
  assert.equal(harness.repository.grants.get(issuedGrant.id)?.consumedAt !== undefined, true);
  const stored = harness.repository.sessions.get(created.session.sessionId);
  assert.equal(stored?.tokenDigest.includes(created.sessionToken), false);
  assert.equal(stored?.csrfTokenDigest.includes(created.csrfToken), false);
  assert.equal(stored?.userAgentSummary, 'Atlas Test Browser');
  assert.equal(harness.auditRepository.records[0]?.action, 'admin.session.created');

  await assert.rejects(
    runInRequest(() =>
      harness.service.createSession({
        grantId: issuedGrant.id,
        grantToken: issuedGrant.token,
        clientAddress: '127.0.0.1',
      }),
    ),
    (error: unknown) => {
      assert.equal(error instanceof DomainError, true);
      assert.equal((error as DomainError).code, ErrorCode.AUTH_REQUIRED);
      return true;
    },
  );
});

test('session authentication touches activity, enters ADMIN context and enforces CSRF', async () => {
  const harness = createHarness();
  const accountId = '0199-0000-7000-8000-000000000002';
  const grant = harness.grantIssuer.issue(clock.now());
  harness.repository.accounts.set(accountId, {
    id: accountId,
    role: AdminRole.ADMIN,
    status: AdminAccountStatus.ACTIVE,
    passwordChangedAt: new Date('2026-08-29T00:00:00.000Z'),
  });
  harness.repository.grants.set(grant.id, {
    id: grant.id,
    adminAccountId: accountId,
    tokenDigest: grant.tokenDigest,
    ipFingerprint: fingerprintLoginAddress('127.0.0.1'),
    expiresAt: new Date(clock.now().getTime() + 120_000),
  });

  const created = await runInRequest(() =>
    harness.service.createSession({
      grantId: grant.id,
      grantToken: grant.token,
      clientAddress: '127.0.0.1',
    }),
  );
  clock.advanceBy(61_000);

  await runInRequest(async () => {
    const principal = await harness.service.authenticateSession({
      sessionToken: created.sessionToken,
      clientAddress: '127.0.0.1',
    });
    harness.service.enterRequestContext(principal);
    assert.equal(requestContext.require().actorType, ActorType.ADMIN);
    assert.equal(requestContext.require().actorId, accountId);
    assert.equal(requestContext.require().sessionId, principal.sessionId);
    harness.service.assertCsrf(principal, created.csrfToken, created.csrfToken);
    assert.throws(
      () => harness.service.assertCsrf(principal, created.csrfToken, 'wrong-token'),
      (error: unknown) => {
        assert.equal(error instanceof DomainError, true);
        assert.equal((error as DomainError).code, ErrorCode.FORBIDDEN);
        return true;
      },
    );
  });

  const touched = harness.repository.sessions.get(created.session.sessionId);
  assert.equal(touched?.lastSeenAt.toISOString(), clock.now().toISOString());
  clock.set('2026-08-30T00:00:00.000Z');
});

test('password or role changes invalidate existing sessions and revoke-others preserves current session', async () => {
  const harness = createHarness();
  const accountId = '0199-0000-7000-8000-000000000003';
  const passwordChangedAt = new Date('2026-08-29T00:00:00.000Z');
  harness.repository.accounts.set(accountId, {
    id: accountId,
    role: AdminRole.OWNER,
    status: AdminAccountStatus.ACTIVE,
    passwordChangedAt,
  });

  const sessions: CreateAdminSessionResult[] = [];
  for (let index = 0; index < 2; index += 1) {
    const grant = harness.grantIssuer.issue(clock.now());
    harness.repository.grants.set(grant.id, {
      id: grant.id,
      adminAccountId: accountId,
      tokenDigest: grant.tokenDigest,
      ipFingerprint: fingerprintLoginAddress('127.0.0.1'),
      expiresAt: new Date(clock.now().getTime() + 120_000),
    });
    sessions.push(
      await runInRequest(() =>
        harness.service.createSession({
          grantId: grant.id,
          grantToken: grant.token,
          clientAddress: '127.0.0.1',
          userAgent: `Browser ${index + 1}`,
        }),
      ),
    );
    clock.advanceBy(1_000);
  }

  const current = await runInRequest(() =>
    harness.service.authenticateSession({
      sessionToken: sessions[1]!.sessionToken,
      clientAddress: '127.0.0.1',
    }),
  );
  const revokedCount = await runInRequest(() => harness.service.revokeOtherSessions(current));
  assert.equal(revokedCount, 1);
  assert.equal(
    harness.repository.sessions.get(sessions[0]!.session.sessionId)?.revokedAt !== undefined,
    true,
  );
  assert.equal(
    harness.repository.sessions.get(sessions[1]!.session.sessionId)?.revokedAt,
    undefined,
  );

  harness.repository.accounts.set(accountId, {
    id: accountId,
    role: AdminRole.ADMIN,
    status: AdminAccountStatus.ACTIVE,
    passwordChangedAt,
  });
  await assert.rejects(
    runInRequest(() =>
      harness.service.authenticateSession({
        sessionToken: sessions[1]!.sessionToken,
        clientAddress: '127.0.0.1',
      }),
    ),
    (error: unknown) => {
      assert.equal(error instanceof DomainError, true);
      assert.equal((error as DomainError).code, ErrorCode.AUTH_REQUIRED);
      return true;
    },
  );
  assert.equal(
    harness.repository.sessions.get(sessions[1]!.session.sessionId)?.revokeReason,
    AdminSessionRevokeReason.ACCOUNT_CHANGED,
  );
  clock.set('2026-08-30T00:00:00.000Z');
});

function fingerprintLoginAddress(address: string): string {
  return createHmac('sha256', loginPepper).update(`ip\u0000${address}`, 'utf8').digest('hex');
}

function cloneGrant(
  grant: AdminSessionAuthenticationGrant | undefined,
): AdminSessionAuthenticationGrant | undefined {
  return grant
    ? {
        ...grant,
        expiresAt: new Date(grant.expiresAt),
        consumedAt: grant.consumedAt ? new Date(grant.consumedAt) : undefined,
        invalidatedAt: grant.invalidatedAt ? new Date(grant.invalidatedAt) : undefined,
      }
    : undefined;
}

function cloneSession<T extends AdminSessionRecord | undefined>(session: T): T {
  return (
    session
      ? {
          ...session,
          passwordChangedAt: new Date(session.passwordChangedAt),
          createdAt: new Date(session.createdAt),
          lastSeenAt: new Date(session.lastSeenAt),
          idleExpiresAt: new Date(session.idleExpiresAt),
          absoluteExpiresAt: new Date(session.absoluteExpiresAt),
          revokedAt: session.revokedAt ? new Date(session.revokedAt) : undefined,
        }
      : undefined
  ) as T;
}
