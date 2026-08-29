import type { DataSource, EntityManager } from 'typeorm';

import type { AdminRole } from '../../domain/admin-role';
import type {
  AdminAccountRepositoryPort,
  InsertAdminAccountRecord,
} from '../../ports/admin-account.repository';
import { AdminAccountEntity } from './admin-account.entity';

const OWNER_BOOTSTRAP_LOCK_KEY = 'atlas.admin-owner-bootstrap.v1';

export class TypeOrmAdminAccountRepository implements AdminAccountRepositoryPort<EntityManager> {
  public constructor(private readonly dataSource: DataSource) {}

  public async acquireOwnerBootstrapLock(transaction: EntityManager): Promise<void> {
    await transaction.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      OWNER_BOOTSTRAP_LOCK_KEY,
    ]);
  }

  public async existsByEmail(email: string, transaction?: EntityManager): Promise<boolean> {
    const count = await this.getRepository(transaction).count({ where: { email } });
    return count > 0;
  }

  public async existsByRole(role: AdminRole, transaction?: EntityManager): Promise<boolean> {
    const count = await this.getRepository(transaction).count({ where: { role } });
    return count > 0;
  }

  public async insert(
    account: InsertAdminAccountRecord,
    transaction?: EntityManager,
  ): Promise<void> {
    await this.getRepository(transaction).insert({
      id: account.id,
      email: account.email,
      displayName: account.displayName,
      passwordHash: account.passwordHash,
      role: account.role,
      status: account.status,
      failedLoginCount: account.failedLoginCount,
      lockedUntil: account.lockedUntil ?? null,
      passwordChangedAt: account.passwordChangedAt,
      lastLoginAt: account.lastLoginAt ?? null,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    });
  }

  private getRepository(transaction?: EntityManager) {
    return (transaction ?? this.dataSource.manager).getRepository(AdminAccountEntity);
  }
}
