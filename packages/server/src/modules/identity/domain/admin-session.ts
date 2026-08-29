import { DomainError, ErrorCode } from '../../../core/errors';
import type { AdminRole } from './admin-role';

export const AdminSessionRevokeReason = {
  ACCOUNT_CHANGED: 'account-changed',
  EXPIRED: 'expired',
  LOGOUT: 'logout',
  MAX_ACTIVE_SESSIONS: 'max-active-sessions',
  OTHER_SESSION_REVOKED: 'other-session-revoked',
  REVOKED_BY_ADMIN: 'revoked-by-admin',
} as const;

export type AdminSessionRevokeReason =
  (typeof AdminSessionRevokeReason)[keyof typeof AdminSessionRevokeReason];

export const AdminSessionStatus = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
} as const;

export type AdminSessionStatus =
  (typeof AdminSessionStatus)[keyof typeof AdminSessionStatus];

export interface AdminSessionPolicy {
  idleTtlMs: number;
  absoluteTtlMs: number;
  touchIntervalMs: number;
  maximumActiveSessions: number;
  bindClientAddress: boolean;
}

export interface AdminSessionStateSource {
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt?: Date;
}

export interface AdminSessionAccountSnapshot {
  role: AdminRole;
  passwordChangedAt: Date;
}

export function validateAdminSessionPolicy(
  policy: AdminSessionPolicy,
): Readonly<AdminSessionPolicy> {
  assertPositiveInteger(policy.idleTtlMs, 'idleTtlMs');
  assertPositiveInteger(policy.absoluteTtlMs, 'absoluteTtlMs');
  assertPositiveInteger(policy.touchIntervalMs, 'touchIntervalMs');
  assertPositiveInteger(policy.maximumActiveSessions, 'maximumActiveSessions');

  if (policy.idleTtlMs > policy.absoluteTtlMs) {
    throw new RangeError('idleTtlMs must not exceed absoluteTtlMs.');
  }

  if (policy.touchIntervalMs > policy.idleTtlMs) {
    throw new RangeError('touchIntervalMs must not exceed idleTtlMs.');
  }

  return Object.freeze({ ...policy });
}

export function calculateAdminSessionExpiry(
  now: Date,
  policy: AdminSessionPolicy,
): Readonly<{ idleExpiresAt: Date; absoluteExpiresAt: Date }> {
  return Object.freeze({
    idleExpiresAt: new Date(now.getTime() + policy.idleTtlMs),
    absoluteExpiresAt: new Date(now.getTime() + policy.absoluteTtlMs),
  });
}

export function resolveAdminSessionStatus(
  session: AdminSessionStateSource,
  now: Date,
): AdminSessionStatus {
  if (session.revokedAt) {
    return AdminSessionStatus.REVOKED;
  }

  if (
    session.idleExpiresAt.getTime() <= now.getTime() ||
    session.absoluteExpiresAt.getTime() <= now.getTime()
  ) {
    return AdminSessionStatus.EXPIRED;
  }

  return AdminSessionStatus.ACTIVE;
}

export function shouldTouchAdminSession(
  lastSeenAt: Date,
  now: Date,
  policy: AdminSessionPolicy,
): boolean {
  return now.getTime() - lastSeenAt.getTime() >= policy.touchIntervalMs;
}

export function calculateTouchedIdleExpiry(
  now: Date,
  absoluteExpiresAt: Date,
  policy: AdminSessionPolicy,
): Date {
  return new Date(
    Math.min(now.getTime() + policy.idleTtlMs, absoluteExpiresAt.getTime()),
  );
}

export function hasAdminAccountSnapshotChanged(
  stored: AdminSessionAccountSnapshot,
  current: AdminSessionAccountSnapshot,
): boolean {
  return (
    stored.role !== current.role ||
    stored.passwordChangedAt.getTime() !== current.passwordChangedAt.getTime()
  );
}

export function normalizeAdminSessionUserAgent(value?: string): string {
  if (!value) {
    return 'unknown';
  }

  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  if (!normalized) {
    return 'unknown';
  }

  return normalized.slice(0, 255);
}

export function assertAdminSessionFingerprintPepper(value: string): void {
  if (Buffer.byteLength(value, 'utf8') < 32) {
    throw new RangeError('Administrator session fingerprint Pepper must contain at least 32 bytes.');
  }
}

export function createAdminSessionAuthenticationError(): DomainError {
  return new DomainError({
    code: ErrorCode.AUTH_REQUIRED,
    message: 'A valid administrator session is required.',
  });
}

export function createAdminSessionCsrfError(): DomainError {
  return new DomainError({
    code: ErrorCode.FORBIDDEN,
    message: 'A valid CSRF token is required.',
  });
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${field} must be a positive safe integer.`);
  }
}
