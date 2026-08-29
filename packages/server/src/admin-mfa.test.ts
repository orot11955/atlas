import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ActorType,
  AdminAccountStatus,
  AdminMfaAlgorithm,
  AdminMfaMethodStatus,
  AdminMfaMethodType,
  AdminMfaService,
  Aes256GcmAdminMfaSecretCipher,
  AuditService,
  DomainError,
  ErrorCode,
  FixedClock,
  HmacAdminRecoveryCodeIssuer,
  NodeAdminTotpAuthenticator,
  Sha256AdminAuthenticationGrantTokenIssuer,
  Sha256AdminLoginChallengeTokenIssuer,
  fingerprintAdminLoginValue,
  generateTotpCode,
  requestContext,
  type ActivateAdminTotpMethodInput,
  type AdminAuthenticationGrantRecord,
  type AdminMfaChallenge,
  type AdminMfaRepositoryPort,
  type AdminRecoveryCodeRecord,
  type AdminTotpMethod,
  type AuditRecord,
  type AuditRepositoryPort,
  type InsertAdminTotpMethodRecord,
  type TransactionRunner,
  type UpdateAdminMfaChallengeFailureInput,
  type UpdateAdminTotpUsageInput,
} from './index';

type TestTransaction = Readonly<{ id: 'mfa-transaction' }>;

class TestTransactionRunner implements TransactionRunner<TestTransaction> {
  private readonly transaction: TestTransaction = Object.freeze({
    id: 'mfa-transaction',
  });

  public run<TResult>(work: (transaction: TestTransaction) => Promise<TResult>): Promise<TResult> {
    return work(this.transaction);
  }
}

class MemoryAdminMfaRepository implements AdminMfaRepositoryPort<TestTransaction> {
  public readonly challenges = new Map<string, AdminMfaChallenge>();
  public readonly methods = new Map<string, AdminTotpMethod>();
  public readonly recoveryCodes = new Map<string, AdminRecoveryCodeRecord>();
  public readonly grants = new Map<string, AdminAuthenticationGrantRecord>();

  public async findChallengeForUpdate(
    challengeId: string,
    _transaction: TestTransaction,
  ): Promise<AdminMfaChallenge | undefined> {
    return cloneChallenge(this.challenges.get(challengeId));
  }

  public async findTotpMethodForUpdate(
    adminAccountId: string,
    _transaction: TestTransaction,
  ): Promise<AdminTotpMethod | undefined> {
    return cloneMethod(
      [...this.methods.values()].find(
        (method) =>
          method.adminAccountId === adminAccountId && method.methodType === AdminMfaMethodType.TOTP,
      ),
    );
  }

  public async insertTotpMethod(
    method: InsertAdminTotpMethodRecord,
    _transaction: TestTransaction,
  ): Promise<void> {
    this.methods.set(method.id, cloneMethod(method)!);
  }

  public async activateTotpMethod(
    methodId: string,
    input: ActivateAdminTotpMethodInput,
    _transaction: TestTransaction,
  ): Promise<void> {
    const method = requireValue(this.methods.get(methodId));

    this.methods.set(methodId, {
      ...method,
      status: AdminMfaMethodStatus.ACTIVE,
      lastUsedStep: input.lastUsedStep,
      activatedAt: new Date(input.activatedAt),
      updatedAt: new Date(input.updatedAt),
    });
  }

  public async updateTotpUsage(
    methodId: string,
    input: UpdateAdminTotpUsageInput,
    _transaction: TestTransaction,
  ): Promise<void> {
    const method = requireValue(this.methods.get(methodId));

    this.methods.set(methodId, {
      ...method,
      lastUsedStep: input.lastUsedStep,
      updatedAt: new Date(input.updatedAt),
    });
  }

  public async updateChallengeFailure(
    challengeId: string,
    input: UpdateAdminMfaChallengeFailureInput,
    _transaction: TestTransaction,
  ): Promise<void> {
    const challenge = requireValue(this.challenges.get(challengeId));

    this.challenges.set(challengeId, {
      ...challenge,
      mfaFailureCount: input.failureCount,
      invalidatedAt: input.invalidatedAt ? new Date(input.invalidatedAt) : undefined,
    });
  }

  public async consumeChallenge(
    challengeId: string,
    consumedAt: Date,
    _transaction: TestTransaction,
  ): Promise<void> {
    const challenge = requireValue(this.challenges.get(challengeId));

    this.challenges.set(challengeId, {
      ...challenge,
      consumedAt: new Date(consumedAt),
    });
  }

  public async replaceRecoveryCodes(
    adminAccountId: string,
    codes: readonly AdminRecoveryCodeRecord[],
    _transaction: TestTransaction,
  ): Promise<void> {
    for (const [id, code] of this.recoveryCodes) {
      if (code.adminAccountId === adminAccountId) {
        this.recoveryCodes.delete(id);
      }
    }

    for (const code of codes) {
      this.recoveryCodes.set(code.id, {
        ...code,
        createdAt: new Date(code.createdAt),
      });
    }
  }

  public async findUnusedRecoveryCodeForUpdate(
    adminAccountId: string,
    codeDigest: string,
    _transaction: TestTransaction,
  ): Promise<AdminRecoveryCodeRecord | undefined> {
    const code = [...this.recoveryCodes.values()].find(
      (entry) =>
        entry.adminAccountId === adminAccountId && entry.codeDigest === codeDigest && !entry.usedAt,
    );

    return code
      ? {
          ...code,
          createdAt: new Date(code.createdAt),
          usedAt: code.usedAt ? new Date(code.usedAt) : undefined,
        }
      : undefined;
  }

  public async markRecoveryCodeUsed(
    recoveryCodeId: string,
    usedAt: Date,
    _transaction: TestTransaction,
  ): Promise<void> {
    const code = requireValue(this.recoveryCodes.get(recoveryCodeId));

    this.recoveryCodes.set(recoveryCodeId, {
      ...code,
      usedAt: new Date(usedAt),
    });
  }

  public async invalidateOpenAuthenticationGrants(
    adminAccountId: string,
    invalidatedAt: Date,
    _transaction: TestTransaction,
  ): Promise<void> {
    for (const [id, grant] of this.grants) {
      if (grant.adminAccountId === adminAccountId && !grant.consumedAt && !grant.invalidatedAt) {
        this.grants.set(id, {
          ...grant,
          invalidatedAt: new Date(invalidatedAt),
        });
      }
    }
  }

  public async insertAuthenticationGrant(
    grant: AdminAuthenticationGrantRecord,
    _transaction: TestTransaction,
  ): Promise<void> {
    this.grants.set(grant.id, {
      ...grant,
      expiresAt: new Date(grant.expiresAt),
      createdAt: new Date(grant.createdAt),
    });
  }
}

class MemoryAuditRepository implements AuditRepositoryPort<TestTransaction> {
  public readonly records: AuditRecord[] = [];

  public async insert(record: AuditRecord, _transaction?: TestTransaction): Promise<void> {
    this.records.push({ ...record });
  }
}

const encryptionKeyBase64 = 'YXRsYXMtbG9jYWwtbWZhLWVuY3J5cHRpb24ta2V5LTE=';
const fingerprintPepper = 'atlas-test-login-fingerprint-pepper-2026';
const recoveryPepper = 'atlas-test-recovery-code-pepper-2026';
const accountId = '0199a000-0000-7000-8000-000000000001';
const clientAddress = '127.0.0.1';

test('TOTP generation matches the RFC 6238 SHA1 vector', () => {
  const code = generateTotpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', new Date(59_000), {
    algorithm: AdminMfaAlgorithm.SHA1,
    digits: 8,
    periodSeconds: 30,
  });

  assert.equal(code, '94287082');
});

test('AES-256-GCM protects MFA secrets and rejects tampering', () => {
  const cipher = new Aes256GcmAdminMfaSecretCipher(encryptionKeyBase64, 'test-v1');
  const encrypted = cipher.encrypt('JBSWY3DPEHPK3PXP');

  assert.equal(encrypted.encryptedValue.includes('JBSWY3DPEHPK3PXP'), false);
  assert.equal(cipher.decrypt(encrypted.encryptedValue, encrypted.keyVersion), 'JBSWY3DPEHPK3PXP');

  const [version, iv, authenticationTag, ciphertext] = encrypted.encryptedValue.split('.');
  const tamperedTag = `${
    authenticationTag?.startsWith('A') ? 'B' : 'A'
  }${authenticationTag?.slice(1) ?? ''}`;
  const tampered = [version, iv, tamperedTag, ciphertext].join('.');

  assert.throws(() => cipher.decrypt(tampered, encrypted.keyVersion));
  assert.throws(() => cipher.decrypt(encrypted.encryptedValue, 'unknown-v2'));
});

test('TOTP enrollment, replay defense, and recovery codes form a one-time chain', async () => {
  const clock = new FixedClock('2026-08-29T13:00:00.000Z');
  const repository = new MemoryAdminMfaRepository();
  const auditRepository = new MemoryAuditRepository();
  const challengeIssuer = new Sha256AdminLoginChallengeTokenIssuer();
  const totp = new NodeAdminTotpAuthenticator();
  const cipher = new Aes256GcmAdminMfaSecretCipher(encryptionKeyBase64, 'test-v1');
  const recoveryIssuer = new HmacAdminRecoveryCodeIssuer(recoveryPepper);
  const service = new AdminMfaService(
    new TestTransactionRunner(),
    repository,
    challengeIssuer,
    totp,
    cipher,
    recoveryIssuer,
    new Sha256AdminAuthenticationGrantTokenIssuer(),
    new AuditService(auditRepository, clock),
    fingerprintPepper,
    {
      issuer: 'Atlas Test',
      totpWindowSteps: 1,
      grantTtlMs: 120_000,
      recoveryCodeCount: 4,
      failureThreshold: 3,
    },
    clock,
  );

  const firstChallenge = addChallenge(repository, challengeIssuer, clock);

  const enrollment = await runAsAnonymous(() =>
    service.startTotpEnrollment({
      ...firstChallenge,
      clientAddress,
    }),
  );
  const repeatedEnrollment = await runAsAnonymous(() =>
    service.startTotpEnrollment({
      ...firstChallenge,
      clientAddress,
    }),
  );

  assert.equal(repeatedEnrollment.methodId, enrollment.methodId);
  assert.equal(repeatedEnrollment.secret, enrollment.secret);
  assert.match(enrollment.provisioningUri, /^otpauth:\/\/totp\//u);

  const storedMethod = requireValue(repository.methods.get(enrollment.methodId));
  assert.equal(storedMethod.status, AdminMfaMethodStatus.PENDING);
  assert.equal(storedMethod.encryptedSecret.includes(enrollment.secret), false);

  const enrollmentCode = generateTotpCode(enrollment.secret, clock.now(), {
    algorithm: AdminMfaAlgorithm.SHA1,
    digits: 6,
    periodSeconds: 30,
  });
  const confirmation = await runAsAnonymous(() =>
    service.confirmTotpEnrollment({
      ...firstChallenge,
      clientAddress,
      code: enrollmentCode,
    }),
  );

  assert.equal(confirmation.nextStep, 'session');
  assert.equal(confirmation.recoveryCodes.length, 4);
  assert.equal(
    repository.challenges.get(firstChallenge.challengeId)?.consumedAt?.toISOString(),
    clock.now().toISOString(),
  );
  assert.equal(repository.methods.get(enrollment.methodId)?.status, AdminMfaMethodStatus.ACTIVE);

  const replayChallenge = addChallenge(repository, challengeIssuer, clock);

  await assert.rejects(
    runAsAnonymous(() =>
      service.verifyTotp({
        ...replayChallenge,
        clientAddress,
        code: enrollmentCode,
      }),
    ),
    (error: unknown) => {
      assert.equal(error instanceof DomainError, true);
      assert.equal((error as DomainError).code, ErrorCode.MFA_REQUIRED);
      return true;
    },
  );

  assert.equal(repository.challenges.get(replayChallenge.challengeId)?.mfaFailureCount, 1);

  clock.advanceBy(30_000);
  const nextChallenge = addChallenge(repository, challengeIssuer, clock);
  const nextCode = generateTotpCode(enrollment.secret, clock.now(), {
    algorithm: AdminMfaAlgorithm.SHA1,
    digits: 6,
    periodSeconds: 30,
  });
  const verified = await runAsAnonymous(() =>
    service.verifyTotp({
      ...nextChallenge,
      clientAddress,
      code: nextCode,
    }),
  );

  assert.equal(verified.nextStep, 'session');

  const recoveryCode = confirmation.recoveryCodes[0]!;
  const recoveryChallenge = addChallenge(repository, challengeIssuer, clock);
  const recovered = await runAsAnonymous(() =>
    service.verifyRecoveryCode({
      ...recoveryChallenge,
      clientAddress,
      recoveryCode,
    }),
  );

  assert.equal(recovered.nextStep, 'session');

  const recoveryReplayChallenge = addChallenge(repository, challengeIssuer, clock);

  await assert.rejects(
    runAsAnonymous(() =>
      service.verifyRecoveryCode({
        ...recoveryReplayChallenge,
        clientAddress,
        recoveryCode,
      }),
    ),
    (error: unknown) => {
      assert.equal(error instanceof DomainError, true);
      assert.equal((error as DomainError).code, ErrorCode.MFA_REQUIRED);
      return true;
    },
  );

  const serializedAudit = JSON.stringify(auditRepository.records);
  assert.equal(serializedAudit.includes(enrollment.secret), false);
  assert.equal(serializedAudit.includes(enrollmentCode), false);
  assert.equal(serializedAudit.includes(recoveryCode), false);
  assert.equal(serializedAudit.includes(confirmation.grantToken), false);
});

function addChallenge(
  repository: MemoryAdminMfaRepository,
  issuer: Sha256AdminLoginChallengeTokenIssuer,
  clock: FixedClock,
): {
  challengeId: string;
  challengeToken: string;
} {
  const issued = issuer.issue(clock.now());

  repository.challenges.set(issued.id, {
    id: issued.id,
    adminAccountId: accountId,
    accountEmail: 'owner@example.com',
    accountStatus: AdminAccountStatus.ACTIVE,
    tokenDigest: issued.tokenDigest,
    ipFingerprint: fingerprintAdminLoginValue(fingerprintPepper, 'ip', clientAddress),
    expiresAt: new Date(clock.now().getTime() + 300_000),
    mfaFailureCount: 0,
    createdAt: clock.now(),
  });

  return {
    challengeId: issued.id,
    challengeToken: issued.token,
  };
}

function runAsAnonymous<TResult>(work: () => Promise<TResult>): Promise<TResult> {
  return requestContext.run(
    {
      requestId: 'mfa-test-request',
      traceId: 'mfa-test-trace',
      actorType: ActorType.ANONYMOUS,
    },
    work,
  );
}

function cloneChallenge(challenge: AdminMfaChallenge | undefined): AdminMfaChallenge | undefined {
  return challenge
    ? {
        ...challenge,
        expiresAt: new Date(challenge.expiresAt),
        consumedAt: challenge.consumedAt ? new Date(challenge.consumedAt) : undefined,
        invalidatedAt: challenge.invalidatedAt ? new Date(challenge.invalidatedAt) : undefined,
        createdAt: new Date(challenge.createdAt),
      }
    : undefined;
}

function cloneMethod(method: AdminTotpMethod | undefined): AdminTotpMethod | undefined {
  return method
    ? {
        ...method,
        enrolledAt: new Date(method.enrolledAt),
        activatedAt: method.activatedAt ? new Date(method.activatedAt) : undefined,
        disabledAt: method.disabledAt ? new Date(method.disabledAt) : undefined,
        createdAt: new Date(method.createdAt),
        updatedAt: new Date(method.updatedAt),
      }
    : undefined;
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected a test value.');
  }

  return value;
}
