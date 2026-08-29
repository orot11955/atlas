import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ActorType,
  AdminAccountStatus,
  AdminLoginAttemptOutcome,
  AdminPasswordLoginService,
  AdminRole,
  AuditService,
  DomainError,
  ErrorCode,
  FixedClock,
  requestContext,
  type AdminAuthenticationAccount,
  type AdminAuthenticationRepositoryPort,
  type AdminLoginAttemptRecord,
  type AdminLoginChallengeRecord,
  type AdminLoginChallengeTokenIssuerPort,
  type AdminLoginRateLimiterPort,
  type AdminLoginRateLimitResult,
  type AuditRecord,
  type AuditRepositoryPort,
  type IssuedAdminLoginChallengeToken,
  type PasswordHasher,
  type TransactionRunner,
  type UpdateAdminLoginStateInput,
} from './index';

type TestTransaction = Readonly<{ id: 'login-transaction' }>;

class TestTransactionRunner implements TransactionRunner<TestTransaction> {
  private readonly transaction: TestTransaction = Object.freeze({ id: 'login-transaction' });

  public run<TResult>(work: (transaction: TestTransaction) => Promise<TResult>): Promise<TResult> {
    return work(this.transaction);
  }
}

class MemoryAuthenticationRepository implements AdminAuthenticationRepositoryPort<TestTransaction> {
  public readonly accounts = new Map<string, AdminAuthenticationAccount>();
  public readonly attempts: AdminLoginAttemptRecord[] = [];
  public readonly challenges: AdminLoginChallengeRecord[] = [];
  public findByEmailCount = 0;

  public async findByEmail(email: string): Promise<AdminAuthenticationAccount | undefined> {
    this.findByEmailCount += 1;
    return cloneAccount([...this.accounts.values()].find((account) => account.email === email));
  }

  public async findByIdForUpdate(
    accountId: string,
    _transaction: TestTransaction,
  ): Promise<AdminAuthenticationAccount | undefined> {
    return cloneAccount(this.accounts.get(accountId));
  }

  public async updateLoginState(
    accountId: string,
    state: UpdateAdminLoginStateInput,
    _transaction: TestTransaction,
  ): Promise<void> {
    const account = this.accounts.get(accountId);

    if (!account) {
      throw new Error('Account missing in test repository.');
    }

    this.accounts.set(accountId, {
      ...account,
      failedLoginCount: state.failedLoginCount,
      lockedUntil: state.lockedUntil ? new Date(state.lockedUntil) : undefined,
      updatedAt: new Date(state.updatedAt),
    });
  }

  public async invalidateOpenLoginChallenges(
    accountId: string,
    invalidatedAt: Date,
    _transaction: TestTransaction,
  ): Promise<void> {
    for (const challenge of this.challenges) {
      if (
        challenge.adminAccountId === accountId &&
        !challenge.consumedAt &&
        !challenge.invalidatedAt
      ) {
        challenge.invalidatedAt = new Date(invalidatedAt);
      }
    }
  }

  public async insertLoginAttempt(
    attempt: AdminLoginAttemptRecord,
    _transaction: TestTransaction,
  ): Promise<void> {
    this.attempts.push({ ...attempt });
  }

  public async insertLoginChallenge(
    challenge: AdminLoginChallengeRecord,
    _transaction: TestTransaction,
  ): Promise<void> {
    this.challenges.push({ ...challenge });
  }
}

class TestPasswordHasher implements PasswordHasher {
  public readonly hashes: string[] = [];

  public async hash(_password: string): Promise<string> {
    throw new Error('Not implemented for login tests.');
  }

  public async verify(encodedHash: string, password: string): Promise<boolean> {
    this.hashes.push(encodedHash);
    return encodedHash === '$argon2id$valid' && password === 'correct password';
  }
}

class TestChallengeIssuer implements AdminLoginChallengeTokenIssuerPort {
  public issue(_issuedAt: Date): Readonly<IssuedAdminLoginChallengeToken> {
    return Object.freeze({
      id: '0199-0000-7000-8000-000000000001',
      token: 'atlas_mfa_0199-0000-7000-8000-000000000001.secret',
      tokenDigest: 'a'.repeat(64),
    });
  }
}

class TestRateLimiter implements AdminLoginRateLimiterPort {
  public result: AdminLoginRateLimitResult = { allowed: true, retryAfterSeconds: 0 };
  public readonly resets: string[] = [];

  public async consume(): Promise<AdminLoginRateLimitResult> {
    return this.result;
  }

  public async resetAccount(email: string): Promise<void> {
    this.resets.push(email);
  }
}

class MemoryAuditRepository implements AuditRepositoryPort<TestTransaction> {
  public readonly records: AuditRecord[] = [];

  public async insert(record: AuditRecord, _transaction?: TestTransaction): Promise<void> {
    this.records.push({ ...record });
  }
}

const clock = new FixedClock('2026-08-29T12:20:00.000Z');

function createAccount(
  overrides: Partial<AdminAuthenticationAccount> = {},
): AdminAuthenticationAccount {
  return {
    id: '0199-0000-7000-8000-000000000010',
    email: 'owner@example.com',
    passwordHash: '$argon2id$valid',
    role: AdminRole.OWNER,
    status: AdminAccountStatus.ACTIVE,
    failedLoginCount: 0,
    passwordChangedAt: new Date('2026-08-29T10:00:00.000Z'),
    updatedAt: new Date('2026-08-29T10:00:00.000Z'),
    ...overrides,
  };
}

function createHarness() {
  const repository = new MemoryAuthenticationRepository();
  const passwordHasher = new TestPasswordHasher();
  const rateLimiter = new TestRateLimiter();
  const auditRepository = new MemoryAuditRepository();
  const service = new AdminPasswordLoginService(
    new TestTransactionRunner(),
    repository,
    passwordHasher,
    new TestChallengeIssuer(),
    rateLimiter,
    new AuditService(auditRepository, clock),
    {
      failureThreshold: 3,
      lockDurationMs: 15 * 60 * 1_000,
      challengeTtlMs: 5 * 60 * 1_000,
    },
    clock,
  );

  return { service, repository, passwordHasher, rateLimiter, auditRepository };
}

async function executeLogin(
  service: AdminPasswordLoginService<TestTransaction>,
  email: string,
  password: string,
) {
  return requestContext.run(
    {
      requestId: 'login-request',
      traceId: 'login-trace',
      actorType: ActorType.ANONYMOUS,
    },
    () =>
      service.execute({
        email,
        password,
        clientAddress: '127.0.0.1',
      }),
  );
}

test('valid password resets failure state and issues only a digested MFA challenge', async () => {
  const harness = createHarness();
  const account = createAccount({
    failedLoginCount: 2,
    lockedUntil: new Date('2026-08-29T12:00:00.000Z'),
  });
  harness.repository.accounts.set(account.id, account);
  harness.repository.challenges.push({
    id: 'old-challenge',
    adminAccountId: account.id,
    tokenDigest: 'b'.repeat(64),
    ipFingerprint: 'c'.repeat(64),
    requestId: 'old-request',
    expiresAt: new Date('2026-08-29T12:30:00.000Z'),
    createdAt: new Date('2026-08-29T12:00:00.000Z'),
  });

  const result = await executeLogin(harness.service, ' OWNER@example.com ', 'correct password');

  assert.equal(result.nextStep, 'mfa');
  assert.equal(result.challengeToken.includes('secret'), true);
  assert.equal(result.expiresAt.toISOString(), '2026-08-29T12:25:00.000Z');
  assert.equal(harness.repository.accounts.get(account.id)?.failedLoginCount, 0);
  assert.equal(harness.repository.accounts.get(account.id)?.lockedUntil, undefined);
  assert.equal(
    harness.repository.challenges[0]?.invalidatedAt?.toISOString(),
    clock.now().toISOString(),
  );
  assert.equal(harness.repository.challenges[1]?.tokenDigest, 'a'.repeat(64));
  assert.equal(
    harness.repository.challenges[1]?.tokenDigest.includes(result.challengeToken),
    false,
  );
  assert.equal(harness.repository.attempts[0]?.outcome, AdminLoginAttemptOutcome.PASSWORD_VERIFIED);
  assert.deepEqual(harness.rateLimiter.resets, ['owner@example.com']);
  assert.equal(JSON.stringify(harness.auditRepository.records).includes('correct password'), false);
  assert.equal(
    JSON.stringify(harness.auditRepository.records).includes('owner@example.com'),
    false,
  );
});

test('unknown email performs dummy password verification and returns a generic error', async () => {
  const harness = createHarness();

  await assert.rejects(
    executeLogin(harness.service, 'missing@example.com', 'wrong password'),
    (error: unknown) => {
      assert.equal(error instanceof DomainError, true);
      assert.equal((error as DomainError).code, ErrorCode.AUTH_REQUIRED);
      assert.equal((error as Error).message, 'Email or password is invalid.');
      return true;
    },
  );

  assert.equal(harness.passwordHasher.hashes.length, 1);
  assert.equal(harness.passwordHasher.hashes[0]?.startsWith('$argon2id$'), true);
  assert.equal(harness.repository.attempts[0]?.adminAccountId, undefined);
  assert.equal(
    harness.repository.attempts[0]?.outcome,
    AdminLoginAttemptOutcome.INVALID_CREDENTIALS,
  );
  assert.equal(JSON.stringify(harness.repository.attempts).includes('missing@example.com'), false);
});

test('the threshold failure locks the account and returns retry metadata', async () => {
  const harness = createHarness();
  const account = createAccount({ failedLoginCount: 2 });
  harness.repository.accounts.set(account.id, account);

  await assert.rejects(
    executeLogin(harness.service, account.email, 'wrong password'),
    (error: unknown) => {
      assert.equal(error instanceof DomainError, true);
      assert.equal((error as DomainError).code, ErrorCode.RATE_LIMITED);
      assert.deepEqual((error as DomainError).details, { retryAfterSeconds: 900 });
      return true;
    },
  );

  const updated = harness.repository.accounts.get(account.id);
  assert.equal(updated?.failedLoginCount, 3);
  assert.equal(updated?.lockedUntil?.toISOString(), '2026-08-29T12:35:00.000Z');
  assert.equal(harness.repository.attempts[0]?.outcome, AdminLoginAttemptOutcome.ACCOUNT_LOCKED);
});

test('rate limiting rejects before account lookup or password hashing', async () => {
  const harness = createHarness();
  harness.rateLimiter.result = { allowed: false, retryAfterSeconds: 42 };

  await assert.rejects(
    executeLogin(harness.service, 'owner@example.com', 'correct password'),
    (error: unknown) => {
      assert.equal(error instanceof DomainError, true);
      assert.equal((error as DomainError).code, ErrorCode.RATE_LIMITED);
      assert.deepEqual((error as DomainError).details, { retryAfterSeconds: 42 });
      return true;
    },
  );

  assert.equal(harness.repository.findByEmailCount, 0);
  assert.equal(harness.passwordHasher.hashes.length, 0);
  assert.equal(harness.repository.attempts.length, 0);
});

function cloneAccount(
  account: AdminAuthenticationAccount | undefined,
): AdminAuthenticationAccount | undefined {
  return account
    ? {
        ...account,
        lockedUntil: account.lockedUntil ? new Date(account.lockedUntil) : undefined,
        passwordChangedAt: new Date(account.passwordChangedAt),
        updatedAt: new Date(account.updatedAt),
      }
    : undefined;
}
