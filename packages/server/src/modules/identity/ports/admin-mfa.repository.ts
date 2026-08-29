import type { AdminAccountStatus } from '../domain/admin-account-status';
import type {
  AdminMfaAlgorithm,
  AdminMfaMethodStatus,
  AdminMfaMethodType,
} from '../domain/admin-mfa';

export interface AdminMfaChallenge {
  id: string;
  adminAccountId: string;
  accountEmail: string;
  accountStatus: AdminAccountStatus;
  tokenDigest: string;
  ipFingerprint: string;
  expiresAt: Date;
  consumedAt?: Date;
  invalidatedAt?: Date;
  mfaFailureCount: number;
  createdAt: Date;
}

export interface AdminTotpMethod {
  id: string;
  adminAccountId: string;
  methodType: AdminMfaMethodType;
  status: AdminMfaMethodStatus;
  encryptedSecret: string;
  secretKeyVersion: string;
  algorithm: AdminMfaAlgorithm;
  digits: number;
  periodSeconds: number;
  lastUsedStep?: number;
  enrolledAt: Date;
  activatedAt?: Date;
  disabledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type InsertAdminTotpMethodRecord = AdminTotpMethod;

export interface ActivateAdminTotpMethodInput {
  lastUsedStep: number;
  activatedAt: Date;
  updatedAt: Date;
}

export interface UpdateAdminTotpUsageInput {
  lastUsedStep: number;
  updatedAt: Date;
}

export interface UpdateAdminMfaChallengeFailureInput {
  failureCount: number;
  invalidatedAt?: Date;
}

export interface AdminRecoveryCodeRecord {
  id: string;
  adminAccountId: string;
  codeDigest: string;
  usedAt?: Date;
  createdAt: Date;
}

export interface AdminAuthenticationGrantRecord {
  id: string;
  adminAccountId: string;
  sourceChallengeId: string;
  tokenDigest: string;
  ipFingerprint: string;
  expiresAt: Date;
  consumedAt?: Date;
  invalidatedAt?: Date;
  createdAt: Date;
}

export interface AdminMfaRepositoryPort<TTransaction = unknown> {
  findChallengeForUpdate(
    challengeId: string,
    transaction: TTransaction,
  ): Promise<AdminMfaChallenge | undefined>;
  findTotpMethodForUpdate(
    adminAccountId: string,
    transaction: TTransaction,
  ): Promise<AdminTotpMethod | undefined>;
  insertTotpMethod(method: InsertAdminTotpMethodRecord, transaction: TTransaction): Promise<void>;
  activateTotpMethod(
    methodId: string,
    input: ActivateAdminTotpMethodInput,
    transaction: TTransaction,
  ): Promise<void>;
  updateTotpUsage(
    methodId: string,
    input: UpdateAdminTotpUsageInput,
    transaction: TTransaction,
  ): Promise<void>;
  updateChallengeFailure(
    challengeId: string,
    input: UpdateAdminMfaChallengeFailureInput,
    transaction: TTransaction,
  ): Promise<void>;
  consumeChallenge(challengeId: string, consumedAt: Date, transaction: TTransaction): Promise<void>;
  replaceRecoveryCodes(
    adminAccountId: string,
    codes: readonly AdminRecoveryCodeRecord[],
    transaction: TTransaction,
  ): Promise<void>;
  findUnusedRecoveryCodeForUpdate(
    adminAccountId: string,
    codeDigest: string,
    transaction: TTransaction,
  ): Promise<AdminRecoveryCodeRecord | undefined>;
  markRecoveryCodeUsed(
    recoveryCodeId: string,
    usedAt: Date,
    transaction: TTransaction,
  ): Promise<void>;
  invalidateOpenAuthenticationGrants(
    adminAccountId: string,
    invalidatedAt: Date,
    transaction: TTransaction,
  ): Promise<void>;
  insertAuthenticationGrant(
    grant: AdminAuthenticationGrantRecord,
    transaction: TTransaction,
  ): Promise<void>;
}
