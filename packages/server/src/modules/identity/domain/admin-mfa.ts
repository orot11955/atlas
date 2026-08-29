import { DomainError, ErrorCode } from '../../../core/errors';

export const AdminMfaMethodType = {
  TOTP: 'totp',
} as const;

export type AdminMfaMethodType =
  (typeof AdminMfaMethodType)[keyof typeof AdminMfaMethodType];

export const AdminMfaMethodStatus = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
  PENDING: 'pending',
} as const;

export type AdminMfaMethodStatus =
  (typeof AdminMfaMethodStatus)[keyof typeof AdminMfaMethodStatus];

export const AdminMfaAlgorithm = {
  SHA1: 'SHA1',
} as const;

export type AdminMfaAlgorithm =
  (typeof AdminMfaAlgorithm)[keyof typeof AdminMfaAlgorithm];

export interface AdminMfaPolicy {
  issuer: string;
  totpWindowSteps: number;
  grantTtlMs: number;
  recoveryCodeCount: number;
  failureThreshold: number;
}

export interface AdminMfaFailureState {
  failureCount: number;
  invalidatedAt?: Date;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TOTP_CODE_PATTERN = /^\d{6}$/u;
const RECOVERY_CODE_PATTERN = /^[A-Z2-9]{16}$/u;

export function validateAdminMfaPolicy(
  policy: AdminMfaPolicy,
): Readonly<AdminMfaPolicy> {
  const issuer = policy.issuer.trim().normalize('NFKC');

  if (
    issuer.length < 1 ||
    issuer.length > 80 ||
    Array.from(issuer).some(isControlCharacter)
  ) {
    throw new RangeError('issuer must contain between 1 and 80 printable characters.');
  }

  assertIntegerInRange(policy.totpWindowSteps, 0, 2, 'totpWindowSteps');
  assertIntegerInRange(policy.grantTtlMs, 30_000, 600_000, 'grantTtlMs');
  assertIntegerInRange(policy.recoveryCodeCount, 1, 20, 'recoveryCodeCount');
  assertIntegerInRange(policy.failureThreshold, 1, 20, 'failureThreshold');

  return Object.freeze({
    issuer,
    totpWindowSteps: policy.totpWindowSteps,
    grantTtlMs: policy.grantTtlMs,
    recoveryCodeCount: policy.recoveryCodeCount,
    failureThreshold: policy.failureThreshold,
  });
}

export function assertAdminMfaChallengeInput(
  challengeId: string,
  challengeToken: string,
): void {
  if (!UUID_PATTERN.test(challengeId)) {
    throw invalidField('challengeId', 'Challenge ID is invalid.');
  }

  if (
    challengeToken.length < 64 ||
    challengeToken.length > 512 ||
    !challengeToken.startsWith(`atlas_mfa_${challengeId}.`) ||
    Array.from(challengeToken).some(isControlCharacter)
  ) {
    throw invalidField('challengeToken', 'Challenge token is invalid.');
  }
}

export function assertAdminTotpCode(code: string): void {
  if (!TOTP_CODE_PATTERN.test(code)) {
    throw invalidField('code', 'TOTP code must contain exactly 6 digits.');
  }
}

export function normalizeAdminRecoveryCode(value: string): string {
  const normalized = value
    .trim()
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s-]/gu, '');

  if (!RECOVERY_CODE_PATTERN.test(normalized)) {
    throw invalidField('recoveryCode', 'Recovery code is invalid.');
  }

  return normalized;
}

export function formatAdminRecoveryCode(normalized: string): string {
  if (!RECOVERY_CODE_PATTERN.test(normalized)) {
    throw new RangeError('normalized recovery code is invalid.');
  }

  return normalized.match(/.{1,4}/gu)?.join('-') ?? normalized;
}

export function calculateAdminMfaFailureState(
  currentFailureCount: number,
  threshold: number,
  attemptedAt: Date,
): Readonly<AdminMfaFailureState> {
  assertIntegerInRange(
    currentFailureCount,
    0,
    Number.MAX_SAFE_INTEGER,
    'currentFailureCount',
  );
  assertIntegerInRange(threshold, 1, 20, 'threshold');

  const failureCount = currentFailureCount + 1;

  return Object.freeze({
    failureCount,
    ...(failureCount >= threshold
      ? { invalidatedAt: new Date(attemptedAt) }
      : {}),
  });
}

function invalidField(field: string, message: string): DomainError {
  return new DomainError({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { field },
  });
}

function assertIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
  field: string,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${field} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
}

function isControlCharacter(value: string): boolean {
  const codePoint = value.codePointAt(0);
  return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
}
