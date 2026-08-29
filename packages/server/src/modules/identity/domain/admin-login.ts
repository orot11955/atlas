import { createHmac } from 'node:crypto';

import { DomainError, ErrorCode } from '../../../core/errors';

const MIN_FINGERPRINT_PEPPER_BYTES = 32;

export const AdminLoginAttemptOutcome = {
  ACCOUNT_DISABLED: 'account-disabled',
  ACCOUNT_LOCKED: 'account-locked',
  INVALID_CREDENTIALS: 'invalid-credentials',
  PASSWORD_VERIFIED: 'password-verified',
} as const;

export type AdminLoginAttemptOutcome =
  (typeof AdminLoginAttemptOutcome)[keyof typeof AdminLoginAttemptOutcome];

export interface AdminPasswordLoginPolicy {
  failureThreshold: number;
  lockDurationMs: number;
  challengeTtlMs: number;
}

export interface FailedLoginSource {
  failedLoginCount: number;
  lockedUntil?: Date;
}

export interface FailedLoginState {
  failedLoginCount: number;
  lockedUntil?: Date;
}

export function validateAdminPasswordLoginPolicy(
  policy: AdminPasswordLoginPolicy,
): Readonly<AdminPasswordLoginPolicy> {
  assertPositiveInteger(policy.failureThreshold, 'failureThreshold');
  assertPositiveInteger(policy.lockDurationMs, 'lockDurationMs');
  assertPositiveInteger(policy.challengeTtlMs, 'challengeTtlMs');

  return Object.freeze({ ...policy });
}

export function assertAdminLoginFingerprintPepper(pepper: string): void {
  if (Buffer.byteLength(pepper, 'utf8') < MIN_FINGERPRINT_PEPPER_BYTES) {
    throw new RangeError(
      `Admin login fingerprint pepper must contain at least ${MIN_FINGERPRINT_PEPPER_BYTES} bytes.`,
    );
  }
}

export function assertAdminLoginPasswordInput(password: string): void {
  const length = Array.from(password).length;

  if (length < 1 || length > 1_024) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Password must contain between 1 and 1024 characters.',
      details: { field: 'password' },
    });
  }
}

export function normalizeAdminLoginClientAddress(value: string): string {
  const normalized = value.trim();

  if (
    normalized.length < 1 ||
    normalized.length > 128 ||
    Array.from(normalized).some(isControlCharacter)
  ) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Client address is invalid.',
      details: { field: 'clientAddress' },
    });
  }

  return normalized;
}

export function fingerprintAdminLoginValue(
  pepper: string,
  namespace: 'email' | 'ip',
  value: string,
): string {
  assertAdminLoginFingerprintPepper(pepper);

  return createHmac('sha256', pepper)
    .update(`${namespace}\u0000${value}`, 'utf8')
    .digest('hex');
}

export function calculateFailedLoginState(
  source: FailedLoginSource,
  attemptedAt: Date,
  policy: AdminPasswordLoginPolicy,
): Readonly<FailedLoginState> {
  if (source.lockedUntil && source.lockedUntil.getTime() > attemptedAt.getTime()) {
    return Object.freeze({
      failedLoginCount: source.failedLoginCount,
      lockedUntil: new Date(source.lockedUntil),
    });
  }

  const baseCount = source.lockedUntil ? 0 : source.failedLoginCount;
  const failedLoginCount = baseCount + 1;
  const lockedUntil =
    failedLoginCount >= policy.failureThreshold
      ? new Date(attemptedAt.getTime() + policy.lockDurationMs)
      : undefined;

  return Object.freeze({
    failedLoginCount,
    ...(lockedUntil ? { lockedUntil } : {}),
  });
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${field} must be a positive safe integer.`);
  }
}

function isControlCharacter(value: string): boolean {
  const codePoint = value.codePointAt(0);
  return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
}
