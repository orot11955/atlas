import type { DataSource, EntityManager, Repository } from 'typeorm';

import { AdminAccountEntity } from './admin-account.entity';
import { AdminAuthenticationGrantEntity } from './admin-authentication-grant.entity';
import { AdminSessionEntity } from './admin-session.entity';
import type { AdminSessionRevokeReason } from '../../domain/admin-session';
import type {
  AdminSessionAccount,
  AdminSessionAuthenticationGrant,
  AdminSessionRecord,
  AdminSessionRepositoryPort,
  InsertAdminSessionRecord,
  TouchAdminSessionInput,
} from '../../ports/admin-session.repository';

export class TypeOrmAdminSessionRepository
  implements AdminSessionRepositoryPort<EntityManager>
{
  public constructor(private readonly dataSource: DataSource) {}

  public async findGrantForUpdate(
    grantId: string,
    transaction: EntityManager,
  ): Promise<AdminSessionAuthenticationGrant | undefined> {
    const entity = await transaction
      .getRepository(AdminAuthenticationGrantEntity)
      .findOne({
        where: { id: grantId },
        lock: { mode: 'pessimistic_write' },
      });

    return entity ? toGrant(entity) : undefined;
  }

  public async consumeGrant(
    grantId: string,
    consumedAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction
      .getRepository(AdminAuthenticationGrantEntity)
      .update({ id: grantId }, { consumedAt });
  }

  public async findAccountForSession(
    accountId: string,
    transaction?: EntityManager,
  ): Promise<AdminSessionAccount | undefined> {
    const repository = (transaction ?? this.dataSource.manager).getRepository(
      AdminAccountEntity,
    );
    const entity = await repository.findOne({ where: { id: accountId } });

    return entity
      ? {
          id: entity.id,
          role: entity.role,
          status: entity.status,
          passwordChangedAt: new Date(entity.passwordChangedAt),
        }
      : undefined;
  }

  public async insertSession(
    session: InsertAdminSessionRecord,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(AdminSessionEntity).insert({
      id: session.id,
      adminAccountId: session.adminAccountId,
      sourceGrantId: session.sourceGrantId,
      tokenDigest: session.tokenDigest,
      csrfTokenDigest: session.csrfTokenDigest,
      clientFingerprint: session.clientFingerprint,
      role: session.role,
      passwordChangedAt: session.passwordChangedAt,
      userAgentSummary: session.userAgentSummary,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      idleExpiresAt: session.idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      revokedAt: session.revokedAt ?? null,
      revokeReason: session.revokeReason ?? null,
    });
  }

  public async findSessionForUpdate(
    sessionId: string,
    transaction: EntityManager,
  ): Promise<AdminSessionRecord | undefined> {
    const entity = await transaction.getRepository(AdminSessionEntity).findOne({
      where: { id: sessionId },
      lock: { mode: 'pessimistic_write' },
    });

    return entity ? toSession(entity) : undefined;
  }

  public async touchSession(
    sessionId: string,
    input: TouchAdminSessionInput,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(AdminSessionEntity).update(
      { id: sessionId },
      {
        lastSeenAt: input.lastSeenAt,
        idleExpiresAt: input.idleExpiresAt,
      },
    );
  }

  public async revokeSession(
    sessionId: string,
    revokedAt: Date,
    reason: AdminSessionRevokeReason,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction
      .getRepository(AdminSessionEntity)
      .createQueryBuilder()
      .update(AdminSessionEntity)
      .set({ revokedAt, revokeReason: reason })
      .where('id = :sessionId', { sessionId })
      .andWhere('revoked_at IS NULL')
      .execute();
  }

  public async listSessionsForAccount(
    accountId: string,
  ): Promise<readonly AdminSessionRecord[]> {
    const entities = await this.dataSource.getRepository(AdminSessionEntity).find({
      where: { adminAccountId: accountId },
      order: { createdAt: 'DESC' },
      take: 100,
    });

    return entities.map(toSession);
  }

  public async revokeOldestActiveSessions(
    accountId: string,
    keepCount: number,
    revokedAt: Date,
    transaction: EntityManager,
  ): Promise<number> {
    const active = await findActiveSessions(
      transaction.getRepository(AdminSessionEntity),
      accountId,
      revokedAt,
      'DESC',
    );
    const revokeIds = active.slice(Math.max(0, keepCount)).map((session) => session.id);

    if (revokeIds.length === 0) {
      return 0;
    }

    const result = await transaction
      .getRepository(AdminSessionEntity)
      .createQueryBuilder()
      .update(AdminSessionEntity)
      .set({ revokedAt, revokeReason: 'max-active-sessions' })
      .whereInIds(revokeIds)
      .andWhere('revoked_at IS NULL')
      .execute();

    return result.affected ?? 0;
  }

  public async revokeOtherActiveSessions(
    accountId: string,
    currentSessionId: string,
    revokedAt: Date,
    transaction: EntityManager,
  ): Promise<number> {
    const result = await transaction
      .getRepository(AdminSessionEntity)
      .createQueryBuilder()
      .update(AdminSessionEntity)
      .set({ revokedAt, revokeReason: 'other-session-revoked' })
      .where('admin_account_id = :accountId', { accountId })
      .andWhere('id <> :currentSessionId', { currentSessionId })
      .andWhere('revoked_at IS NULL')
      .andWhere('idle_expires_at > :revokedAt', { revokedAt })
      .andWhere('absolute_expires_at > :revokedAt', { revokedAt })
      .execute();

    return result.affected ?? 0;
  }
}

async function findActiveSessions(
  repository: Repository<AdminSessionEntity>,
  accountId: string,
  now: Date,
  order: 'ASC' | 'DESC',
): Promise<AdminSessionEntity[]> {
  return repository
    .createQueryBuilder('session')
    .where('session.admin_account_id = :accountId', { accountId })
    .andWhere('session.revoked_at IS NULL')
    .andWhere('session.idle_expires_at > :now', { now })
    .andWhere('session.absolute_expires_at > :now', { now })
    .orderBy('session.created_at', order)
    .setLock('pessimistic_read')
    .getMany();
}

function toGrant(
  entity: AdminAuthenticationGrantEntity,
): AdminSessionAuthenticationGrant {
  return {
    id: entity.id,
    adminAccountId: entity.adminAccountId,
    tokenDigest: entity.tokenDigest,
    ipFingerprint: entity.ipFingerprint,
    expiresAt: new Date(entity.expiresAt),
    consumedAt: entity.consumedAt ? new Date(entity.consumedAt) : undefined,
    invalidatedAt: entity.invalidatedAt
      ? new Date(entity.invalidatedAt)
      : undefined,
  };
}

function toSession(entity: AdminSessionEntity): AdminSessionRecord {
  return {
    id: entity.id,
    adminAccountId: entity.adminAccountId,
    sourceGrantId: entity.sourceGrantId,
    tokenDigest: entity.tokenDigest,
    csrfTokenDigest: entity.csrfTokenDigest,
    clientFingerprint: entity.clientFingerprint,
    role: entity.role,
    passwordChangedAt: new Date(entity.passwordChangedAt),
    userAgentSummary: entity.userAgentSummary,
    createdAt: new Date(entity.createdAt),
    lastSeenAt: new Date(entity.lastSeenAt),
    idleExpiresAt: new Date(entity.idleExpiresAt),
    absoluteExpiresAt: new Date(entity.absoluteExpiresAt),
    revokedAt: entity.revokedAt ? new Date(entity.revokedAt) : undefined,
    revokeReason: entity.revokeReason ?? undefined,
  };
}
