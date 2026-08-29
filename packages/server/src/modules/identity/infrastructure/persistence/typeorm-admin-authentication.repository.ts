import type { DataSource, EntityManager } from 'typeorm';

import { AdminMfaMethodStatus, AdminMfaMethodType } from '../../domain/admin-mfa';
import type {
  AdminAuthenticationAccount,
  AdminAuthenticationRepositoryPort,
  AdminLoginAttemptRecord,
  AdminLoginChallengeRecord,
  UpdateAdminLoginStateInput,
} from '../../ports/admin-authentication.repository';
import { AdminAccountEntity } from './admin-account.entity';
import { AdminLoginAttemptEntity } from './admin-login-attempt.entity';
import { AdminLoginChallengeEntity } from './admin-login-challenge.entity';
import { AdminMfaMethodEntity } from './admin-mfa-method.entity';

export class TypeOrmAdminAuthenticationRepository
  implements AdminAuthenticationRepositoryPort<EntityManager>
{
  public constructor(private readonly dataSource: DataSource) {}

  public async findByEmail(email: string): Promise<AdminAuthenticationAccount | undefined> {
    const entity = await this.dataSource.getRepository(AdminAccountEntity).findOne({
      where: { email },
    });

    return entity ? toAuthenticationAccount(entity) : undefined;
  }

  public async findByIdForUpdate(
    accountId: string,
    transaction: EntityManager,
  ): Promise<AdminAuthenticationAccount | undefined> {
    const entity = await transaction.getRepository(AdminAccountEntity).findOne({
      where: { id: accountId },
      lock: { mode: 'pessimistic_write' },
    });

    return entity ? toAuthenticationAccount(entity) : undefined;
  }

  public async hasActiveTotpMethod(
    accountId: string,
    transaction?: EntityManager,
  ): Promise<boolean> {
    const manager = transaction ?? this.dataSource.manager;
    const count = await manager.getRepository(AdminMfaMethodEntity).count({
      where: {
        adminAccountId: accountId,
        methodType: AdminMfaMethodType.TOTP,
        status: AdminMfaMethodStatus.ACTIVE,
      },
    });

    return count > 0;
  }

  public async updateLoginState(
    accountId: string,
    state: UpdateAdminLoginStateInput,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(AdminAccountEntity).update(
      { id: accountId },
      {
        failedLoginCount: state.failedLoginCount,
        lockedUntil: state.lockedUntil ?? null,
        updatedAt: state.updatedAt,
      },
    );
  }

  public async invalidateOpenLoginChallenges(
    accountId: string,
    invalidatedAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction
      .getRepository(AdminLoginChallengeEntity)
      .createQueryBuilder()
      .update(AdminLoginChallengeEntity)
      .set({ invalidatedAt })
      .where('admin_account_id = :accountId', { accountId })
      .andWhere('consumed_at IS NULL')
      .andWhere('invalidated_at IS NULL')
      .execute();
  }

  public async insertLoginAttempt(
    attempt: AdminLoginAttemptRecord,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(AdminLoginAttemptEntity).insert({
      id: attempt.id,
      adminAccountId: attempt.adminAccountId ?? null,
      emailFingerprint: attempt.emailFingerprint,
      ipFingerprint: attempt.ipFingerprint,
      outcome: attempt.outcome,
      requestId: attempt.requestId,
      occurredAt: attempt.occurredAt,
    });
  }

  public async insertLoginChallenge(
    challenge: AdminLoginChallengeRecord,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(AdminLoginChallengeEntity).insert({
      id: challenge.id,
      adminAccountId: challenge.adminAccountId,
      tokenDigest: challenge.tokenDigest,
      ipFingerprint: challenge.ipFingerprint,
      requestId: challenge.requestId,
      expiresAt: challenge.expiresAt,
      mfaFailureCount: challenge.mfaFailureCount ?? 0,
      consumedAt: challenge.consumedAt ?? null,
      invalidatedAt: challenge.invalidatedAt ?? null,
      createdAt: challenge.createdAt,
    });
  }
}

function toAuthenticationAccount(entity: AdminAccountEntity): AdminAuthenticationAccount {
  return {
    id: entity.id,
    email: entity.email,
    passwordHash: entity.passwordHash,
    role: entity.role,
    status: entity.status,
    failedLoginCount: entity.failedLoginCount,
    lockedUntil: entity.lockedUntil ? new Date(entity.lockedUntil) : undefined,
    passwordChangedAt: new Date(entity.passwordChangedAt),
    updatedAt: new Date(entity.updatedAt),
  };
}
