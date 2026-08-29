import type { AdminAccountStatus } from '../domain/admin-account-status';
import type { AdminLoginAttemptOutcome } from '../domain/admin-login';
import type { AdminRole } from '../domain/admin-role';

export interface AdminAuthenticationAccount {
  id: string;
  email: string;
  passwordHash: string;
  role: AdminRole;
  status: AdminAccountStatus;
  failedLoginCount: number;
  lockedUntil?: Date;
  passwordChangedAt: Date;
  updatedAt: Date;
}

export interface UpdateAdminLoginStateInput {
  failedLoginCount: number;
  lockedUntil?: Date;
  updatedAt: Date;
}

export interface AdminLoginAttemptRecord {
  id: string;
  adminAccountId?: string;
  emailFingerprint: string;
  ipFingerprint: string;
  outcome: AdminLoginAttemptOutcome;
  requestId: string;
  occurredAt: Date;
}

export interface AdminLoginChallengeRecord {
  id: string;
  adminAccountId: string;
  tokenDigest: string;
  ipFingerprint: string;
  requestId: string;
  expiresAt: Date;
  consumedAt?: Date;
  invalidatedAt?: Date;
  createdAt: Date;
}

export interface AdminAuthenticationRepositoryPort<TTransaction = unknown> {
  findByEmail(email: string): Promise<AdminAuthenticationAccount | undefined>;
  findByIdForUpdate(
    accountId: string,
    transaction: TTransaction,
  ): Promise<AdminAuthenticationAccount | undefined>;
  updateLoginState(
    accountId: string,
    state: UpdateAdminLoginStateInput,
    transaction: TTransaction,
  ): Promise<void>;
  invalidateOpenLoginChallenges(
    accountId: string,
    invalidatedAt: Date,
    transaction: TTransaction,
  ): Promise<void>;
  insertLoginAttempt(attempt: AdminLoginAttemptRecord, transaction: TTransaction): Promise<void>;
  insertLoginChallenge(
    challenge: AdminLoginChallengeRecord,
    transaction: TTransaction,
  ): Promise<void>;
}
