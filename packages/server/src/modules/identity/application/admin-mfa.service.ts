import { timingSafeEqual } from 'node:crypto';

import type { AuditService, Clock, TransactionRunner } from '../../../core';
import {
  AuditResult,
  DomainError,
  ErrorCode,
  createUuidV7,
  systemClock,
} from '../../../core';
import { AdminAccountStatus } from '../domain/admin-account-status';
import {
  AdminMfaAlgorithm,
  AdminMfaMethodStatus,
  AdminMfaMethodType,
  assertAdminMfaChallengeInput,
  assertAdminTotpCode,
  calculateAdminMfaFailureState,
  normalizeAdminRecoveryCode,
  validateAdminMfaPolicy,
  type AdminMfaPolicy,
} from '../domain/admin-mfa';
import {
  assertAdminLoginFingerprintPepper,
  fingerprintAdminLoginValue,
  normalizeAdminLoginClientAddress,
} from '../domain/admin-login';
import type { AdminAuthenticationGrantTokenIssuerPort } from '../ports/admin-authentication-grant-token-issuer.port';
import type { AdminLoginChallengeTokenIssuerPort } from '../ports/admin-login-challenge-token-issuer.port';
import type {
  AdminMfaChallenge,
  AdminMfaRepositoryPort,
} from '../ports/admin-mfa.repository';
import type { AdminMfaSecretCipherPort } from '../ports/admin-mfa-secret-cipher.port';
import type { AdminRecoveryCodeIssuerPort } from '../ports/admin-recovery-code-issuer.port';
import type { AdminTotpAuthenticatorPort } from '../ports/admin-totp-authenticator.port';

const TOTP_DIGITS = 6 as const;
const TOTP_PERIOD_SECONDS = 30 as const;

export interface AdminMfaChallengeInput {
  challengeId: string;
  challengeToken: string;
  clientAddress: string;
}

export interface AdminTotpVerificationInput extends AdminMfaChallengeInput {
  code: string;
}

export interface AdminRecoveryCodeVerificationInput extends AdminMfaChallengeInput {
  recoveryCode: string;
}

export interface AdminTotpEnrollmentResult {
  methodId: string;
  secret: string;
  provisioningUri: string;
  algorithm: typeof AdminMfaAlgorithm.SHA1;
  digits: typeof TOTP_DIGITS;
  period: typeof TOTP_PERIOD_SECONDS;
}

export interface AdminAuthenticationGrantResult {
  grantId: string;
  grantToken: string;
  expiresAt: Date;
  nextStep: 'session';
}

export interface AdminTotpEnrollmentConfirmationResult extends AdminAuthenticationGrantResult {
  recoveryCodes: readonly string[];
}

type ServiceDecision<TResult> =
  | {
      kind: 'accepted';
      result: Readonly<TResult>;
    }
  | {
      kind: 'denied';
      error: DomainError;
    };

type ChallengeDecision =
  | {
      kind: 'accepted';
      challenge: AdminMfaChallenge;
      ipFingerprint: string;
    }
  | {
      kind: 'denied';
      error: DomainError;
    };

export class AdminMfaService<TTransaction> {
  private readonly policy: Readonly<AdminMfaPolicy>;

  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: AdminMfaRepositoryPort<TTransaction>,
    private readonly challengeTokenIssuer: AdminLoginChallengeTokenIssuerPort,
    private readonly totpAuthenticator: AdminTotpAuthenticatorPort,
    private readonly secretCipher: AdminMfaSecretCipherPort,
    private readonly recoveryCodeIssuer: AdminRecoveryCodeIssuerPort,
    private readonly grantTokenIssuer: AdminAuthenticationGrantTokenIssuerPort,
    private readonly auditService: AuditService<TTransaction>,
    private readonly fingerprintPepper: string,
    policy: AdminMfaPolicy,
    private readonly clock: Clock = systemClock,
  ) {
    assertAdminLoginFingerprintPepper(fingerprintPepper);
    this.policy = validateAdminMfaPolicy(policy);
  }

  public async startTotpEnrollment(
    input: AdminMfaChallengeInput,
  ): Promise<Readonly<AdminTotpEnrollmentResult>> {
    const normalized = this.normalizeChallengeInput(input);
    const attemptedAt = this.clock.now();

    const decision = await this.transactionRunner.run(
      async (transaction): Promise<ServiceDecision<AdminTotpEnrollmentResult>> => {
        const challengeDecision = await this.validateChallenge(
          normalized,
          attemptedAt,
          transaction,
          'totp-enrollment',
        );

        if (challengeDecision.kind === 'denied') {
          return challengeDecision;
        }

        const { challenge } = challengeDecision;
        const existingMethod = await this.repository.findTotpMethodForUpdate(
          challenge.adminAccountId,
          transaction,
        );

        if (existingMethod?.status === AdminMfaMethodStatus.ACTIVE) {
          await this.recordDeniedAudit(
            challenge,
            'totp-already-active',
            transaction,
            'totp-enrollment',
          );

          return {
            kind: 'denied',
            error: new DomainError({
              code: ErrorCode.INVALID_STATE_TRANSITION,
              message: 'TOTP is already enrolled for this account.',
            }),
          };
        }

        if (existingMethod?.status === AdminMfaMethodStatus.DISABLED) {
          await this.recordDeniedAudit(
            challenge,
            'totp-disabled',
            transaction,
            'totp-enrollment',
          );

          return {
            kind: 'denied',
            error: new DomainError({
              code: ErrorCode.INVALID_STATE_TRANSITION,
              message: 'The disabled TOTP method must be reset before enrollment.',
            }),
          };
        }

        let methodId: string;
        let secret: string;
        let reusedPendingMethod = false;

        if (existingMethod) {
          methodId = existingMethod.id;
          secret = this.secretCipher.decrypt(
            existingMethod.encryptedSecret,
            existingMethod.secretKeyVersion,
          );
          reusedPendingMethod = true;
        } else {
          methodId = createUuidV7(attemptedAt.getTime());
          secret = this.totpAuthenticator.generateSecret();
          const encrypted = this.secretCipher.encrypt(secret);

          await this.repository.insertTotpMethod(
            {
              id: methodId,
              adminAccountId: challenge.adminAccountId,
              methodType: AdminMfaMethodType.TOTP,
              status: AdminMfaMethodStatus.PENDING,
              encryptedSecret: encrypted.encryptedValue,
              secretKeyVersion: encrypted.keyVersion,
              algorithm: AdminMfaAlgorithm.SHA1,
              digits: TOTP_DIGITS,
              periodSeconds: TOTP_PERIOD_SECONDS,
              enrolledAt: attemptedAt,
              createdAt: attemptedAt,
              updatedAt: attemptedAt,
            },
            transaction,
          );
        }

        await this.auditService.record(
          {
            action: 'admin.mfa.totp.enrollment-started',
            targetType: 'admin-mfa-method',
            targetId: methodId,
            result: AuditResult.SUCCESS,
            metadata: {
              adminAccountId: challenge.adminAccountId,
              challengeId: challenge.id,
              reusedPendingMethod,
            },
          },
          transaction,
        );

        return {
          kind: 'accepted',
          result: Object.freeze({
            methodId,
            secret,
            provisioningUri: this.totpAuthenticator.createProvisioningUri({
              issuer: this.policy.issuer,
              accountName: challenge.accountEmail,
              secret,
              algorithm: AdminMfaAlgorithm.SHA1,
              digits: TOTP_DIGITS,
              periodSeconds: TOTP_PERIOD_SECONDS,
            }),
            algorithm: AdminMfaAlgorithm.SHA1,
            digits: TOTP_DIGITS,
            period: TOTP_PERIOD_SECONDS,
          }),
        };
      },
    );

    return unwrapDecision(decision);
  }

  public async confirmTotpEnrollment(
    input: AdminTotpVerificationInput,
  ): Promise<Readonly<AdminTotpEnrollmentConfirmationResult>> {
    assertAdminTotpCode(input.code);
    const normalized = this.normalizeChallengeInput(input);
    const attemptedAt = this.clock.now();

    const decision = await this.transactionRunner.run(
      async (
        transaction,
      ): Promise<ServiceDecision<AdminTotpEnrollmentConfirmationResult>> => {
        const challengeDecision = await this.validateChallenge(
          normalized,
          attemptedAt,
          transaction,
          'totp-confirm',
        );

        if (challengeDecision.kind === 'denied') {
          return challengeDecision;
        }

        const { challenge, ipFingerprint } = challengeDecision;
        const method = await this.repository.findTotpMethodForUpdate(
          challenge.adminAccountId,
          transaction,
        );

        if (!method || method.status !== AdminMfaMethodStatus.PENDING) {
          await this.recordDeniedAudit(
            challenge,
            'totp-enrollment-not-pending',
            transaction,
            'totp-confirm',
          );

          return {
            kind: 'denied',
            error: new DomainError({
              code: ErrorCode.INVALID_STATE_TRANSITION,
              message: 'A pending TOTP enrollment is required.',
            }),
          };
        }

        const secret = this.secretCipher.decrypt(
          method.encryptedSecret,
          method.secretKeyVersion,
        );
        const matchedStep = this.totpAuthenticator.matchCode({
          secret,
          code: input.code,
          at: attemptedAt,
          windowSteps: this.policy.totpWindowSteps,
          algorithm: method.algorithm,
          digits: method.digits,
          periodSeconds: method.periodSeconds,
        });

        if (matchedStep === undefined) {
          return this.handleVerificationFailure(
            challenge,
            'invalid-totp',
            transaction,
          );
        }

        const issuedRecoveryCodes = this.recoveryCodeIssuer.issue(
          this.policy.recoveryCodeCount,
        );
        const recoveryCodeRecords = issuedRecoveryCodes.map((entry) => ({
          id: createUuidV7(attemptedAt.getTime()),
          adminAccountId: challenge.adminAccountId,
          codeDigest: entry.digest,
          createdAt: attemptedAt,
        }));

        await this.repository.activateTotpMethod(
          method.id,
          {
            lastUsedStep: matchedStep,
            activatedAt: attemptedAt,
            updatedAt: attemptedAt,
          },
          transaction,
        );
        await this.repository.replaceRecoveryCodes(
          challenge.adminAccountId,
          recoveryCodeRecords,
          transaction,
        );
        await this.repository.consumeChallenge(challenge.id, attemptedAt, transaction);

        const grant = await this.issueGrant(
          challenge.id,
          challenge.adminAccountId,
          ipFingerprint,
          attemptedAt,
          transaction,
        );

        await this.auditService.record(
          {
            action: 'admin.mfa.totp.activated',
            targetType: 'admin-mfa-method',
            targetId: method.id,
            result: AuditResult.SUCCESS,
            metadata: {
              adminAccountId: challenge.adminAccountId,
              challengeId: challenge.id,
              grantId: grant.grantId,
              recoveryCodeCount: issuedRecoveryCodes.length,
            },
          },
          transaction,
        );

        return {
          kind: 'accepted',
          result: Object.freeze({
            ...grant,
            recoveryCodes: Object.freeze(issuedRecoveryCodes.map((entry) => entry.code)),
          }),
        };
      },
    );

    return unwrapDecision(decision);
  }

  public async verifyTotp(
    input: AdminTotpVerificationInput,
  ): Promise<Readonly<AdminAuthenticationGrantResult>> {
    assertAdminTotpCode(input.code);
    const normalized = this.normalizeChallengeInput(input);
    const attemptedAt = this.clock.now();

    const decision = await this.transactionRunner.run(
      async (transaction): Promise<ServiceDecision<AdminAuthenticationGrantResult>> => {
        const challengeDecision = await this.validateChallenge(
          normalized,
          attemptedAt,
          transaction,
          'totp-verify',
        );

        if (challengeDecision.kind === 'denied') {
          return challengeDecision;
        }

        const { challenge, ipFingerprint } = challengeDecision;
        const method = await this.repository.findTotpMethodForUpdate(
          challenge.adminAccountId,
          transaction,
        );

        if (!method || method.status !== AdminMfaMethodStatus.ACTIVE) {
          await this.recordDeniedAudit(
            challenge,
            'totp-not-active',
            transaction,
            'totp-verify',
          );

          return {
            kind: 'denied',
            error: createMfaRequiredError(),
          };
        }

        const secret = this.secretCipher.decrypt(
          method.encryptedSecret,
          method.secretKeyVersion,
        );
        const matchedStep = this.totpAuthenticator.matchCode({
          secret,
          code: input.code,
          at: attemptedAt,
          windowSteps: this.policy.totpWindowSteps,
          algorithm: method.algorithm,
          digits: method.digits,
          periodSeconds: method.periodSeconds,
        });

        if (
          matchedStep === undefined ||
          (method.lastUsedStep !== undefined && matchedStep <= method.lastUsedStep)
        ) {
          return this.handleVerificationFailure(
            challenge,
            matchedStep === undefined ? 'invalid-totp' : 'replayed-totp',
            transaction,
          );
        }

        await this.repository.updateTotpUsage(
          method.id,
          {
            lastUsedStep: matchedStep,
            updatedAt: attemptedAt,
          },
          transaction,
        );
        await this.repository.consumeChallenge(challenge.id, attemptedAt, transaction);

        const grant = await this.issueGrant(
          challenge.id,
          challenge.adminAccountId,
          ipFingerprint,
          attemptedAt,
          transaction,
        );

        await this.auditService.record(
          {
            action: 'admin.mfa.totp.verified',
            targetType: 'admin-account',
            targetId: challenge.adminAccountId,
            result: AuditResult.SUCCESS,
            metadata: {
              challengeId: challenge.id,
              methodId: method.id,
              grantId: grant.grantId,
            },
          },
          transaction,
        );

        return {
          kind: 'accepted',
          result: grant,
        };
      },
    );

    return unwrapDecision(decision);
  }

  public async verifyRecoveryCode(
    input: AdminRecoveryCodeVerificationInput,
  ): Promise<Readonly<AdminAuthenticationGrantResult>> {
    const normalizedRecoveryCode = normalizeAdminRecoveryCode(input.recoveryCode);
    const codeDigest = this.recoveryCodeIssuer.digest(normalizedRecoveryCode);
    const normalized = this.normalizeChallengeInput(input);
    const attemptedAt = this.clock.now();

    const decision = await this.transactionRunner.run(
      async (transaction): Promise<ServiceDecision<AdminAuthenticationGrantResult>> => {
        const challengeDecision = await this.validateChallenge(
          normalized,
          attemptedAt,
          transaction,
          'recovery-verify',
        );

        if (challengeDecision.kind === 'denied') {
          return challengeDecision;
        }

        const { challenge, ipFingerprint } = challengeDecision;
        const method = await this.repository.findTotpMethodForUpdate(
          challenge.adminAccountId,
          transaction,
        );

        if (!method || method.status !== AdminMfaMethodStatus.ACTIVE) {
          await this.recordDeniedAudit(
            challenge,
            'recovery-without-active-mfa',
            transaction,
            'recovery-verify',
          );

          return {
            kind: 'denied',
            error: createMfaRequiredError(),
          };
        }

        const recoveryCode = await this.repository.findUnusedRecoveryCodeForUpdate(
          challenge.adminAccountId,
          codeDigest,
          transaction,
        );

        if (!recoveryCode) {
          return this.handleVerificationFailure(
            challenge,
            'invalid-recovery-code',
            transaction,
          );
        }

        await this.repository.markRecoveryCodeUsed(recoveryCode.id, attemptedAt, transaction);
        await this.repository.consumeChallenge(challenge.id, attemptedAt, transaction);

        const grant = await this.issueGrant(
          challenge.id,
          challenge.adminAccountId,
          ipFingerprint,
          attemptedAt,
          transaction,
        );

        await this.auditService.record(
          {
            action: 'admin.mfa.recovery.verified',
            targetType: 'admin-account',
            targetId: challenge.adminAccountId,
            result: AuditResult.SUCCESS,
            metadata: {
              challengeId: challenge.id,
              recoveryCodeId: recoveryCode.id,
              grantId: grant.grantId,
            },
          },
          transaction,
        );

        return {
          kind: 'accepted',
          result: grant,
        };
      },
    );

    return unwrapDecision(decision);
  }

  private normalizeChallengeInput(
    input: AdminMfaChallengeInput,
  ): Readonly<AdminMfaChallengeInput> {
    assertAdminMfaChallengeInput(input.challengeId, input.challengeToken);

    return Object.freeze({
      challengeId: input.challengeId.toLowerCase(),
      challengeToken: input.challengeToken,
      clientAddress: normalizeAdminLoginClientAddress(input.clientAddress),
    });
  }

  private async validateChallenge(
    input: Readonly<AdminMfaChallengeInput>,
    attemptedAt: Date,
    transaction: TTransaction,
    operation: string,
  ): Promise<ChallengeDecision> {
    const challenge = await this.repository.findChallengeForUpdate(
      input.challengeId,
      transaction,
    );
    const ipFingerprint = fingerprintAdminLoginValue(
      this.fingerprintPepper,
      'ip',
      input.clientAddress,
    );

    if (!challenge) {
      await this.auditService.record(
        {
          action: 'admin.mfa.verification-denied',
          targetType: 'admin-login-challenge',
          targetId: input.challengeId,
          result: AuditResult.DENIED,
          errorCode: ErrorCode.MFA_REQUIRED,
          metadata: {
            operation,
            reason: 'challenge-not-found',
          },
        },
        transaction,
      );

      return {
        kind: 'denied',
        error: createMfaRequiredError(),
      };
    }

    const tokenMatches = this.challengeTokenIssuer.matches(
      input.challengeToken,
      challenge.tokenDigest,
    );
    const addressMatches = safeDigestEqual(ipFingerprint, challenge.ipFingerprint);
    const expired = challenge.expiresAt.getTime() <= attemptedAt.getTime();
    const terminal = Boolean(challenge.consumedAt || challenge.invalidatedAt);
    const inactive = challenge.accountStatus !== AdminAccountStatus.ACTIVE;

    if (!tokenMatches || !addressMatches || expired || terminal || inactive) {
      if (tokenMatches && expired && !terminal) {
        await this.repository.updateChallengeFailure(
          challenge.id,
          {
            failureCount: challenge.mfaFailureCount,
            invalidatedAt: attemptedAt,
          },
          transaction,
        );
      }

      await this.recordDeniedAudit(
        challenge,
        !tokenMatches
          ? 'token-mismatch'
          : !addressMatches
            ? 'client-address-mismatch'
            : expired
              ? 'challenge-expired'
              : terminal
                ? 'challenge-consumed-or-invalidated'
                : 'account-inactive',
        transaction,
        operation,
      );

      return {
        kind: 'denied',
        error: createMfaRequiredError(),
      };
    }

    return {
      kind: 'accepted',
      challenge,
      ipFingerprint,
    };
  }

  private async handleVerificationFailure<TResult>(
    challenge: AdminMfaChallenge,
    reason: string,
    transaction: TTransaction,
  ): Promise<ServiceDecision<TResult>> {
    const attemptedAt = this.clock.now();
    const state = calculateAdminMfaFailureState(
      challenge.mfaFailureCount,
      this.policy.failureThreshold,
      attemptedAt,
    );

    await this.repository.updateChallengeFailure(
      challenge.id,
      {
        failureCount: state.failureCount,
        invalidatedAt: state.invalidatedAt,
      },
      transaction,
    );
    await this.recordDeniedAudit(
      challenge,
      reason,
      transaction,
      undefined,
      state.failureCount,
      Boolean(state.invalidatedAt),
    );

    return {
      kind: 'denied',
      error: createMfaRequiredError(),
    };
  }

  private async issueGrant(
    challengeId: string,
    adminAccountId: string,
    ipFingerprint: string,
    issuedAt: Date,
    transaction: TTransaction,
  ): Promise<Readonly<AdminAuthenticationGrantResult>> {
    await this.repository.invalidateOpenAuthenticationGrants(
      adminAccountId,
      issuedAt,
      transaction,
    );

    const token = this.grantTokenIssuer.issue(issuedAt);
    const expiresAt = new Date(issuedAt.getTime() + this.policy.grantTtlMs);

    await this.repository.insertAuthenticationGrant(
      {
        id: token.id,
        adminAccountId,
        sourceChallengeId: challengeId,
        tokenDigest: token.tokenDigest,
        ipFingerprint,
        expiresAt,
        createdAt: issuedAt,
      },
      transaction,
    );

    return Object.freeze({
      grantId: token.id,
      grantToken: token.token,
      expiresAt,
      nextStep: 'session',
    });
  }

  private async recordDeniedAudit(
    challenge: AdminMfaChallenge,
    reason: string,
    transaction: TTransaction,
    operation?: string,
    failureCount?: number,
    challengeInvalidated?: boolean,
  ): Promise<void> {
    await this.auditService.record(
      {
        action: 'admin.mfa.verification-denied',
        targetType: 'admin-account',
        targetId: challenge.adminAccountId,
        result: AuditResult.DENIED,
        errorCode: ErrorCode.MFA_REQUIRED,
        metadata: {
          challengeId: challenge.id,
          reason,
          ...(operation ? { operation } : {}),
          ...(failureCount === undefined ? {} : { failureCount }),
          ...(challengeInvalidated === undefined ? {} : { challengeInvalidated }),
        },
      },
      transaction,
    );
  }
}

function unwrapDecision<TResult>(decision: ServiceDecision<TResult>): Readonly<TResult> {
  if (decision.kind === 'denied') {
    throw decision.error;
  }

  return decision.result;
}

function createMfaRequiredError(): DomainError {
  return new DomainError({
    code: ErrorCode.MFA_REQUIRED,
    message: 'MFA verification failed or the challenge is invalid.',
  });
}

function safeDigestEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
