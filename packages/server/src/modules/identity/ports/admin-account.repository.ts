import type { AdminAccountStatus } from '../domain/admin-account-status';
import type { AdminRole } from '../domain/admin-role';

export interface InsertAdminAccountRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: AdminRole;
  status: AdminAccountStatus;
  failedLoginCount: number;
  lockedUntil?: Date;
  passwordChangedAt: Date;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminAccountRepositoryPort<TTransaction = unknown> {
  acquireOwnerBootstrapLock(transaction: TTransaction): Promise<void>;
  existsByEmail(email: string, transaction?: TTransaction): Promise<boolean>;
  existsByRole(role: AdminRole, transaction?: TTransaction): Promise<boolean>;
  insert(account: InsertAdminAccountRecord, transaction?: TTransaction): Promise<void>;
}
