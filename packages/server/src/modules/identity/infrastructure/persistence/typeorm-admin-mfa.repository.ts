import { IsNull, type DataSource, type EntityManager } from 'typeorm';

import { AdminMfaMethodStatus, AdminMfaMethodType } from '../../domain/admin-mfa';
import type {
  ActivateAdminTotpMethodInput,
  AdminAuthenticationGrantRecord,
  AdminMfaChallenge,
  AdminMfaRepositoryPort,
  AdminRecoveryCodeRecord,
  AdminTotpMethod,
  InsertAdminTotpMethodRecord,
  UpdateAdminMfaChallengeFailureInput,
  UpdateAdminTotpUsageInput,
} from '../../ports/admin-mfa.repository';
import { AdminAccountEntity } from './admin-account.entity';
import { AdminAuthenticationGrantEntity } from './admin-authentication-grant.entity';
import { AdminLoginChallengeEntity } from './admin-login-challenge.entity';
import { AdminMfaMethodEntity } from './admin-mfa-method.entity';
import { AdminRecoveryCodeEntity } from './admin-recovery-code.entity';

export class TypeOrmAdminMfaRepository implements AdminMfaRepositoryPort<EntityManager> {
  public constructor(private readonly dataSource: DataSource) {}

  public async findChallengeForUpdate(
    challengeId: string,
    transaction: EntityManager,
  ): Promise<AdminMfaChallenge | undefined> {
    const challenge = await transaction.getRepository(AdminLoginChallengeEntity).findOne({
      where: { id: challengeId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!challenge) {
      return undefined;
    }

    const account = await transaction.getRepository(AdminAccountEntity).findOne({
      where: { id: challenge.adminAccountId },
      lock: { mode: 'pessimistic_read' },
    });

    if (!account) {
      return undefined;
    }

    return {
      id: challenge.id,
      adminAccountId: challenge.adminAccountId,
      accountEmail: account.email,
      accountStatus: account.status,
      tokenDigest: challenge.tokenDigest,
      ipFingerprint: challenge.ipFingerprint,
      expiresAt: new Date(challenge.expiresAt),
      consumedAt: challenge.consumedAt ? new Date(challenge.consumedAt) : undefined,
      invalidatedAt: challenge.invalidatedAt ? new Date(challenge.invalidatedAt) : undefined,
      mfaFailureCount: challenge.mfaFailureCount,
      createdAt: new Date(challenge.createdAt),
    };
  }

  public async findTotpMethodForUpdate(
    adminAccountId: string,
    transaction: EntityManager,
  ): Promise<AdminTotpMethod | undefined> {
    const entity = await transaction.getRepository(AdminMfaMethodEntity).findOne({
      where: {
        adminAccountId,
        methodType: AdminMfaMethodType.TOTP,
      },
      lock: { mode: 'pessimistic_write' },
    });

    return entity ? toTotpMethod(entity) : undefined;
  }

  public async insertTotpMethod(
    method: InsertAdminTotpMethodRecord,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(AdminMfaMethodEntity).insert({
      id: method.id,
      adminAccountId: method.adminAccountId,
      methodType: method.methodType,
      status: method.status,
      encryptedSecret: method.encryptedSecret,
      secretKeyVersion: method.secretKeyVersion,
      algorithm: method.algorithm,
      digits: method.digits,
      periodSeconds: method.periodSeconds,
      lastUsedStep: method.lastUsedStep ?? null,
      enrolledAt: method.enrolledAt,
      activatedAt: method.activatedAt ?? null,
      disabledAt: method.disabledAt ?? null,
      createdAt: method.createdAt,
      updatedAt: method.updatedAt,
    });
  }

  public async activateTotpMethod(
    methodId: string,
    input: ActivateAdminTotpMethodInput,
    transaction: EntityManager,
  ): Promise<void> {
    const result = await transaction.getRepository(AdminMfaMethodEntity).update(
      {
        id: methodId,
        status: AdminMfaMethodStatus.PENDING,
      },
      {
        status: AdminMfaMethodStatus.ACTIVE,
        lastUsedStep: input.lastUsedStep,
        activatedAt: input.activatedAt,
        updatedAt: input.updatedAt,
      },
    );

    assertSingleRowChanged(result.affected, 'activate TOTP method');
  }

  public async updateTotpUsage(
    methodId: string,
    input: UpdateAdminTotpUsageInput,
    transaction: EntityManager,
  ): Promise<void> {
    const result = await transaction.getRepository(AdminMfaMethodEntity).update(
      {
        id: methodId,
        status: AdminMfaMethodStatus.ACTIVE,
      },
      {
        lastUsedStep: input.lastUsedStep,
        updatedAt: input.updatedAt,
      },
    );

    assertSingleRowChanged(result.affected, 'update TOTP usage');
  }

  public async updateChallengeFailure(
    challengeId: string,
    input: UpdateAdminMfaChallengeFailureInput,
    transaction: EntityManager,
  ): Promise<void> {
    const result = await transaction.getRepository(AdminLoginChallengeEntity).update(
      { id: challengeId },
      {
        mfaFailureCount: input.failureCount,
        invalidatedAt: input.invalidatedAt ?? null,
      },
    );

    assertSingleRowChanged(result.affected, 'update MFA challenge failure state');
  }

  public async consumeChallenge(
    challengeId: string,
    consumedAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    const result = await transaction.getRepository(AdminLoginChallengeEntity).update(
      {
        id: challengeId,
        consumedAt: IsNull(),
        invalidatedAt: IsNull(),
      },
      { consumedAt },
    );

    assertSingleRowChanged(result.affected, 'consume MFA challenge');
  }

  public async replaceRecoveryCodes(
    adminAccountId: string,
    codes: readonly AdminRecoveryCodeRecord[],
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(AdminRecoveryCodeEntity).delete({ adminAccountId });

    if (codes.length === 0) {
      return;
    }

    await transaction.getRepository(AdminRecoveryCodeEntity).insert(
      codes.map((code) => ({
        id: code.id,
        adminAccountId: code.adminAccountId,
        codeDigest: code.codeDigest,
        usedAt: code.usedAt ?? null,
        createdAt: code.createdAt,
      })),
    );
  }

  public async findUnusedRecoveryCodeForUpdate(
    adminAccountId: string,
    codeDigest: string,
    transaction: EntityManager,
  ): Promise<AdminRecoveryCodeRecord | undefined> {
    const entity = await transaction.getRepository(AdminRecoveryCodeEntity).findOne({
      where: {
        adminAccountId,
        codeDigest,
        usedAt: IsNull(),
      },
      lock: { mode: 'pessimistic_write' },
    });

    return entity
      ? {
          id: entity.id,
          adminAccountId: entity.adminAccountId,
          codeDigest: entity.codeDigest,
          usedAt: entity.usedAt ? new Date(entity.usedAt) : undefined,
          createdAt: new Date(entity.createdAt),
        }
      : undefined;
  }

  public async markRecoveryCodeUsed(
    recoveryCodeId: string,
    usedAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    const result = await transaction.getRepository(AdminRecoveryCodeEntity).update(
      {
        id: recoveryCodeId,
        usedAt: IsNull(),
      },
      { usedAt },
    );

    assertSingleRowChanged(result.affected, 'consume recovery code');
  }

  public async invalidateOpenAuthenticationGrants(
    adminAccountId: string,
    invalidatedAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction
      .getRepository(AdminAuthenticationGrantEntity)
      .createQueryBuilder()
      .update(AdminAuthenticationGrantEntity)
      .set({ invalidatedAt })
      .where('admin_account_id = :adminAccountId', { adminAccountId })
      .andWhere('consumed_at IS NULL')
      .andWhere('invalidated_at IS NULL')
      .execute();
  }

  public async insertAuthenticationGrant(
    grant: AdminAuthenticationGrantRecord,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(AdminAuthenticationGrantEntity).insert({
      id: grant.id,
      adminAccountId: grant.adminAccountId,
      sourceChallengeId: grant.sourceChallengeId,
      tokenDigest: grant.tokenDigest,
      ipFingerprint: grant.ipFingerprint,
      expiresAt: grant.expiresAt,
      consumedAt: grant.consumedAt ?? null,
      invalidatedAt: grant.invalidatedAt ?? null,
      createdAt: grant.createdAt,
    });
  }
}

function toTotpMethod(entity: AdminMfaMethodEntity): AdminTotpMethod {
  return {
    id: entity.id,
    adminAccountId: entity.adminAccountId,
    methodType: entity.methodType,
    status: entity.status,
    encryptedSecret: entity.encryptedSecret,
    secretKeyVersion: entity.secretKeyVersion,
    algorithm: entity.algorithm,
    digits: entity.digits,
    periodSeconds: entity.periodSeconds,
    lastUsedStep: entity.lastUsedStep === null ? undefined : entity.lastUsedStep,
    enrolledAt: new Date(entity.enrolledAt),
    activatedAt: entity.activatedAt ? new Date(entity.activatedAt) : undefined,
    disabledAt: entity.disabledAt ? new Date(entity.disabledAt) : undefined,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

function assertSingleRowChanged(affected: number | null | undefined, operation: string): void {
  if (affected !== 1) {
    throw new Error(`Failed to ${operation}.`);
  }
}
