import type { AuditService, Clock, TransactionRunner } from '../../../core';
import {
  AuditResult,
  DomainError,
  ErrorCode,
  createUuidV7,
  requestContext,
  systemClock,
} from '../../../core';
import { AdminAccountStatus } from '../domain/admin-account-status';
import { normalizeAdminEmail } from '../domain/admin-account';
import {
  AdminLoginAttemptOutcome,
  assertAdminLoginPasswordInput,
  calculateFailedLoginState,
  fingerprintAdminLoginValue,
  normalizeAdminLoginClientAddress,
  validateAdminPasswordLoginPolicy,
  type AdminPasswordLoginPolicy,
} from '../domain/admin-login';
import type { AdminAuthenticationRepositoryPort } from '../ports/admin-authentication.repository';
import type {
  AdminLoginChallengeTokenIssuerPort,
} from '../ports/admin-login-challenge-token-issuer.port';
import type { AdminLoginRateLimiterPort } from '../ports/admin-login-rate-limiter.port';
import type { PasswordHasher } from '../ports/password-hasher.port';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$' +
  'c2FsdHNhbHRzYWx0c2FsdA$' +
  'ZGlnZXN0ZGlnZXN0ZGlnZXN0ZGlnZXN0ZGlnZXN0ZGlnZXN0';

export interface AdminPasswordLoginInput {
  email: string;
  password: string;
  clientAddress: string;
}

export interface AdminPasswordLoginResult {
  challengeId: string;
  challengeToken: string;
  expiresAt: Date;
  nextStep: 'mfa';
}

type AuthenticationDecision =
  | {
      kind: 'accepted';
      result: Readonly<AdminPasswordLoginResult>;
    }
  | {
      kind: 'denied';
      outcome:
        | typeof AdminLoginAttemptOutcome.ACCOUNT_DISABLED
        | typeof AdminLoginAttemptOutcome.ACCOUNT_LOCKED
        | typeof AdminLoginAttemptOutcome.INVALID_CREDENTIALS;
      retryAfterSeconds?: number;
    };

export class AdminPasswordLoginService<TTransaction> {
  private readonly policy: Readonly<AdminPasswordLoginPolicy>;

  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: AdminAuthenticationRepositoryPort<TTransaction>,
    private readonly passwordHasher: PasswordHasher,
    private readonly challengeTokenIssuer: AdminLoginChallengeTokenIssuerPort,
    private readonly loginRateLimiter: AdminLoginRateLimiterPort,
    private readonly auditService: AuditService<TTransaction>,
    policy: AdminPasswordLoginPolicy,
    private readonly clock: Clock = systemClock,
  ) {
    this.policy = validateAdminPasswordLoginPolicy(policy);
  }

  public async execute(
    input: AdminPasswordLoginInput,
  ): Promise<Readonly<AdminPasswordLoginResult>> {
    const email = normalizeAdminEmail(input.email);
    const clientAddress = normalizeAdminLoginClientAddress(input.clientAddress);
    assertAdminLoginPasswordInput(input.password);

    const rateLimit = await this.loginRateLimiter.consume({ email, clientAddress });

    if (!rateLimit.allowed) {
      throw createRateLimitedError(rateLimit.retryAfterSeconds);
    }

    const attemptedAt = this.clock.now();
    const emailFingerprint = fingerprintAdminLoginValue('email', email);
    const ipFingerprint = fingerprintAdminLoginValue('ip', clientAddress);
    const account = await this.repository.findByEmail(email);
    const passwordHash = account?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordValid = await this.passwordHasher.verify(passwordHash, input.password);

    if (!account) {
      await this.transactionRunner.run(async (transaction) => {
        await this.recordAttemptAndAudit(
          {
            outcome: AdminLoginAttemptOutcome.INVALID_CREDENTIALS,
            emailFingerprint,
            ipFingerprint,
            attemptedAt,
          },
          transaction,
        );
      });

      throw createInvalidCredentialsError();
    }

    const decision = await this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findByIdForUpdate(account.id, transaction);

      if (!current || current.passwordHash !== account.passwordHash) {
        await this.recordAttemptAndAudit(
          {
            accountId: account.id,
            outcome: AdminLoginAttemptOutcome.INVALID_CREDENTIALS,
            emailFingerprint,
            ipFingerprint,
            attemptedAt,
          },
          transaction,
        );

        return {
          kind: 'denied',
          outcome: AdminLoginAttemptOutcome.INVALID_CREDENTIALS,
        } satisfies AuthenticationDecision;
      }

      if (current.status !== AdminAccountStatus.ACTIVE) {
        await this.recordAttemptAndAudit(
          {
            accountId: current.id,
            outcome: AdminLoginAttemptOutcome.ACCOUNT_DISABLED,
            emailFingerprint,
            ipFingerprint,
            attemptedAt,
          },
          transaction,
        );

        return {
          kind: 'denied',
          outcome: AdminLoginAttemptOutcome.ACCOUNT_DISABLED,
        } satisfies AuthenticationDecision;
      }

      if (current.lockedUntil && current.lockedUntil.getTime() > attemptedAt.getTime()) {
        const retryAfterSeconds = secondsUntil(current.lockedUntil, attemptedAt);

        await this.recordAttemptAndAudit(
          {
            accountId: current.id,
            outcome: AdminLoginAttemptOutcome.ACCOUNT_LOCKED,
            emailFingerprint,
            ipFingerprint,
            attemptedAt,
            failedLoginCount: current.failedLoginCount,
            lockedUntil: current.lockedUntil,
          },
          transaction,
        );

        return {
          kind: 'denied',
          outcome: AdminLoginAttemptOutcome.ACCOUNT_LOCKED,
          retryAfterSeconds,
        } satisfies AuthenticationDecision;
      }

      if (!passwordValid) {
        const state = calculateFailedLoginState(current, attemptedAt, this.policy);

        await this.repository.updateLoginState(
          current.id,
          {
            failedLoginCount: state.failedLoginCount,
            lockedUntil: state.lockedUntil,
            updatedAt: attemptedAt,
          },
          transaction,
        );

        const outcome = state.lockedUntil
          ? AdminLoginAttemptOutcome.ACCOUNT_LOCKED
          : AdminLoginAttemptOutcome.INVALID_CREDENTIALS;

        await this.recordAttemptAndAudit(
          {
            accountId: current.id,
            outcome,
            emailFingerprint,
            ipFingerprint,
            attemptedAt,
            failedLoginCount: state.failedLoginCount,
            lockedUntil: state.lockedUntil,
          },
          transaction,
        );

        return {
          kind: 'denied',
          outcome,
          ...(state.lockedUntil
            ? { retryAfterSeconds: secondsUntil(state.lockedUntil, attemptedAt) }
            : {}),
        } satisfies AuthenticationDecision;
      }

      const challenge = this.challengeTokenIssuer.issue(attemptedAt);
      const expiresAt = new Date(attemptedAt.getTime() + this.policy.challengeTtlMs);

      await this.repository.updateLoginState(
        current.id,
        {
          failedLoginCount: 0,
          updatedAt: attemptedAt,
        },
        transaction,
      );
      await this.repository.invalidateOpenLoginChallenges(current.id, attemptedAt, transaction);
      await this.repository.insertLoginChallenge(
        {
          id: challenge.id,
          adminAccountId: current.id,
          tokenDigest: challenge.tokenDigest,
          ipFingerprint,
          requestId: requestContext.require().requestId,
          expiresAt,
          createdAt: attemptedAt,
        },
        transaction,
      );
      await this.recordAttemptAndAudit(
        {
          accountId: current.id,
          outcome: AdminLoginAttemptOutcome.PASSWORD_VERIFIED,
          emailFingerprint,
          ipFingerprint,
          attemptedAt,
        },
        transaction,
      );

      return {
        kind: 'accepted',
        result: Object.freeze({
          challengeId: challenge.id,
          challengeToken: challenge.token,
          expiresAt,
          nextStep: 'mfa',
        }),
      } satisfies AuthenticationDecision;
    });

    if (decision.kind === 'denied') {
      if (decision.outcome === AdminLoginAttemptOutcome.ACCOUNT_LOCKED) {
        throw createRateLimitedError(decision.retryAfterSeconds ?? 1);
      }

      throw createInvalidCredentialsError();
    }

    await this.loginRateLimiter.resetAccount(email).catch(() => undefined);
    return decision.result;
  }

  private async recordAttemptAndAudit(
    input: {
      accountId?: string;
      outcome: AdminLoginAttemptOutcome;
      emailFingerprint: string;
      ipFingerprint: string;
      attemptedAt: Date;
      failedLoginCount?: number;
      lockedUntil?: Date;
    },
    transaction: TTransaction,
  ): Promise<void> {
    const requestId = requestContext.require().requestId;
    const successful = input.outcome === AdminLoginAttemptOutcome.PASSWORD_VERIFIED;
    const errorCode =
      input.outcome === AdminLoginAttemptOutcome.ACCOUNT_LOCKED
        ? ErrorCode.RATE_LIMITED
        : successful
          ? undefined
          : ErrorCode.AUTH_REQUIRED;

    await this.repository.insertLoginAttempt(
      {
        id: createUuidV7(input.attemptedAt.getTime()),
        adminAccountId: input.accountId,
        emailFingerprint: input.emailFingerprint,
        ipFingerprint: input.ipFingerprint,
        outcome: input.outcome,
        requestId,
        occurredAt: input.attemptedAt,
      },
      transaction,
    );

    await this.auditService.record(
      {
        action: successful ? 'admin.login.password-verified' : 'admin.login.denied',
        targetType: 'admin-account',
        targetId: input.accountId,
        result: successful ? AuditResult.SUCCESS : AuditResult.DENIED,
        errorCode,
        metadata: {
          outcome: input.outcome,
          emailFingerprint: input.emailFingerprint,
          ipFingerprint: input.ipFingerprint,
          ...(input.failedLoginCount === undefined
            ? {}
            : { failedLoginCount: input.failedLoginCount }),
          ...(input.lockedUntil ? { lockedUntil: input.lockedUntil } : {}),
        },
      },
      transaction,
    );
  }
}

function createInvalidCredentialsError(): DomainError {
  return new DomainError({
    code: ErrorCode.AUTH_REQUIRED,
    message: 'Email or password is invalid.',
  });
}

function createRateLimitedError(retryAfterSeconds: number): DomainError {
  return new DomainError({
    code: ErrorCode.RATE_LIMITED,
    message: 'Too many login attempts. Try again later.',
    details: {
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)),
    },
  });
}

function secondsUntil(later: Date, earlier: Date): number {
  return Math.max(1, Math.ceil((later.getTime() - earlier.getTime()) / 1_000));
}
