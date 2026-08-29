import type { AdminAccountStatus } from '../domain/admin-account-status';
import type { AdminRole } from '../domain/admin-role';
import type { AdminSessionRevokeReason } from '../domain/admin-session';

export interface AdminSessionAuthenticationGrant {
  id: string;
  adminAccountId: string;
  tokenDigest: string;
  ipFingerprint: string;
  expiresAt: Date;
  consumedAt?: Date;
  invalidatedAt?: Date;
}

export interface AdminSessionAccount {
  id: string;
  role: AdminRole;
  status: AdminAccountStatus;
  passwordChangedAt: Date;
}

export interface AdminSessionRecord {
  id: string;
  adminAccountId: string;
  sourceGrantId: string;
  tokenDigest: string;
  csrfTokenDigest: string;
  clientFingerprint: string;
  role: AdminRole;
  passwordChangedAt: Date;
  userAgentSummary: string;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt?: Date;
  revokeReason?: AdminSessionRevokeReason;
}

export interface InsertAdminSessionRecord extends AdminSessionRecord {}

export interface TouchAdminSessionInput {
  lastSeenAt: Date;
  idleExpiresAt: Date;
}

export interface AdminSessionRepositoryPort<TTransaction = unknown> {
  findGrantForUpdate(
    grantId: string,
    transaction: TTransaction,
  ): Promise<AdminSessionAuthenticationGrant | undefined>;
  consumeGrant(grantId: string, consumedAt: Date, transaction: TTransaction): Promise<void>;
  findAccountForSession(
    accountId: string,
    transaction?: TTransaction,
  ): Promise<AdminSessionAccount | undefined>;
  insertSession(session: InsertAdminSessionRecord, transaction: TTransaction): Promise<void>;
  findSessionForUpdate(
    sessionId: string,
    transaction: TTransaction,
  ): Promise<AdminSessionRecord | undefined>;
  touchSession(
    sessionId: string,
    input: TouchAdminSessionInput,
    transaction: TTransaction,
  ): Promise<void>;
  revokeSession(
    sessionId: string,
    revokedAt: Date,
    reason: AdminSessionRevokeReason,
    transaction: TTransaction,
  ): Promise<void>;
  listSessionsForAccount(accountId: string): Promise<readonly AdminSessionRecord[]>;
  revokeOldestActiveSessions(
    accountId: string,
    keepCount: number,
    revokedAt: Date,
    transaction: TTransaction,
  ): Promise<number>;
  revokeOtherActiveSessions(
    accountId: string,
    currentSessionId: string,
    revokedAt: Date,
    transaction: TTransaction,
  ): Promise<number>;
}
