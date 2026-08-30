import { In, type DataSource, type EntityManager } from 'typeorm';

import { SiteDomainEntity } from '../../../site/infrastructure/persistence/site-domain.entity';
import { SiteEntity } from '../../../site/infrastructure/persistence/site.entity';
import type {
  ApiClientKeyRecord,
  ApiClientRecord,
  ApiClientSiteContext,
} from '../../domain/api-client';
import type {
  ApiClientAuthenticationRecord,
  ApiClientListQuery,
  ApiClientRepositoryPort,
  InsertApiClientAggregate,
  StoredApiClientKey,
  UpdateApiClientConfigurationInput,
  UpdateApiClientStatusInput,
} from '../../ports/api-client.repository';
import { ApiClientAllowedOriginEntity } from './api-client-allowed-origin.entity';
import { ApiClientKeyEntity } from './api-client-key.entity';
import { ApiClientScopeEntity } from './api-client-scope.entity';
import { ApiClientSiteAccessEntity } from './api-client-site-access.entity';
import { ApiClientEntity } from './api-client.entity';

export class TypeOrmApiClientRepository implements ApiClientRepositoryPort<EntityManager> {
  public constructor(private readonly dataSource: DataSource) {}

  public async list(
    workspaceId: string,
    query: ApiClientListQuery,
  ): Promise<readonly ApiClientRecord[]> {
    const builder = this.dataSource
      .getRepository(ApiClientEntity)
      .createQueryBuilder('client')
      .where('client.workspace_id = :workspaceId', { workspaceId });

    if (query.siteId) {
      builder.innerJoin(
        ApiClientSiteAccessEntity,
        'site_access',
        'site_access.api_client_id = client.id AND site_access.site_id = :siteId',
        { siteId: query.siteId },
      );
    }

    if (query.status) {
      builder.andWhere('client.status = :status', { status: query.status });
    }

    if (query.type) {
      builder.andWhere('client.type = :type', { type: query.type });
    }

    if (query.search) {
      builder.andWhere(
        "(client.name ILIKE :search ESCAPE '\\' OR client.description ILIKE :search ESCAPE '\\')",
        { search: `%${escapeLike(query.search)}%` },
      );
    }

    const clients = await builder
      .orderBy('client.created_at', 'DESC')
      .addOrderBy('client.id', 'DESC')
      .take(100)
      .getMany();

    return this.hydrateClients(clients, this.dataSource.manager);
  }

  public async findById(
    workspaceId: string,
    apiClientId: string,
    transaction?: EntityManager,
  ): Promise<ApiClientRecord | undefined> {
    const manager = transaction ?? this.dataSource.manager;
    const entity = await manager.getRepository(ApiClientEntity).findOne({
      where: { id: apiClientId, workspaceId },
    });

    if (!entity) {
      return undefined;
    }

    const [client] = await this.hydrateClients([entity], manager);
    return client;
  }

  public async findExistingSiteIds(
    workspaceId: string,
    siteIds: readonly string[],
    transaction?: EntityManager,
  ): Promise<readonly string[]> {
    if (siteIds.length === 0) {
      return [];
    }

    const entities = await (transaction ?? this.dataSource.manager).getRepository(SiteEntity).find({
      where: {
        workspaceId,
        id: In([...siteIds]),
      },
    });

    return entities.map((entity) => entity.id).sort();
  }

  public async insert(
    aggregate: InsertApiClientAggregate,
    transaction: EntityManager,
  ): Promise<void> {
    const { client, initialKey } = aggregate;
    await transaction.getRepository(ApiClientEntity).insert({
      id: client.id,
      workspaceId: client.workspaceId,
      name: client.name,
      description: client.description ?? null,
      type: client.type,
      status: client.status,
      rateLimitPerMinute: client.rateLimitPerMinute,
      requireOrigin: client.requireOrigin,
      version: client.version,
      disabledAt: client.disabledAt ?? null,
      archivedAt: client.archivedAt ?? null,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    });
    await transaction.getRepository(ApiClientSiteAccessEntity).insert(
      client.siteIds.map((siteId) => ({
        apiClientId: client.id,
        siteId,
        workspaceId: client.workspaceId,
        createdAt: client.createdAt,
      })),
    );
    await transaction.getRepository(ApiClientScopeEntity).insert(
      client.scopes.map((scope) => ({
        apiClientId: client.id,
        scope,
        createdAt: client.createdAt,
      })),
    );

    if (client.allowedOrigins.length > 0) {
      await transaction.getRepository(ApiClientAllowedOriginEntity).insert(
        client.allowedOrigins.map((origin) => ({
          apiClientId: client.id,
          origin,
          createdAt: client.createdAt,
        })),
      );
    }

    await this.insertKey(initialKey, transaction);
  }

  public async updateConfiguration(
    workspaceId: string,
    apiClientId: string,
    input: UpdateApiClientConfigurationInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(ApiClientEntity).update(
      { id: apiClientId, workspaceId, version: input.expectedVersion },
      {
        name: input.name,
        description: input.description ?? null,
        rateLimitPerMinute: input.rateLimitPerMinute,
        requireOrigin: input.requireOrigin,
        version: input.nextVersion,
        updatedAt: input.updatedAt,
      },
    );

    if ((result.affected ?? 0) !== 1) {
      return false;
    }

    await transaction.getRepository(ApiClientSiteAccessEntity).delete({ apiClientId });
    await transaction.getRepository(ApiClientScopeEntity).delete({ apiClientId });
    await transaction.getRepository(ApiClientAllowedOriginEntity).delete({ apiClientId });
    await transaction.getRepository(ApiClientSiteAccessEntity).insert(
      input.siteIds.map((siteId) => ({
        apiClientId,
        siteId,
        workspaceId,
        createdAt: input.updatedAt,
      })),
    );
    await transaction.getRepository(ApiClientScopeEntity).insert(
      input.scopes.map((scope) => ({
        apiClientId,
        scope,
        createdAt: input.updatedAt,
      })),
    );

    if (input.allowedOrigins.length > 0) {
      await transaction.getRepository(ApiClientAllowedOriginEntity).insert(
        input.allowedOrigins.map((origin) => ({
          apiClientId,
          origin,
          createdAt: input.updatedAt,
        })),
      );
    }

    return true;
  }

  public async updateStatus(
    workspaceId: string,
    apiClientId: string,
    input: UpdateApiClientStatusInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(ApiClientEntity).update(
      { id: apiClientId, workspaceId, version: input.expectedVersion },
      {
        status: input.status,
        disabledAt: input.disabledAt ?? null,
        archivedAt: input.archivedAt ?? null,
        version: input.nextVersion,
        updatedAt: input.updatedAt,
      },
    );

    return (result.affected ?? 0) === 1;
  }

  public async revokeAllOpenKeys(
    apiClientId: string,
    revokedAt: Date,
    transaction: EntityManager,
  ): Promise<number> {
    const result = await transaction
      .getRepository(ApiClientKeyEntity)
      .createQueryBuilder()
      .update(ApiClientKeyEntity)
      .set({ revokedAt })
      .where('api_client_id = :apiClientId', { apiClientId })
      .andWhere('revoked_at IS NULL')
      .execute();

    return result.affected ?? 0;
  }

  public async findCurrentKeyForUpdate(
    apiClientId: string,
    transaction: EntityManager,
  ): Promise<StoredApiClientKey | undefined> {
    const entity = await transaction
      .getRepository(ApiClientKeyEntity)
      .createQueryBuilder('key')
      .where('key.api_client_id = :apiClientId', { apiClientId })
      .andWhere('key.revoked_at IS NULL')
      .andWhere('key.replaced_by_key_id IS NULL')
      .setLock('pessimistic_write')
      .getOne();

    return entity ? toStoredKey(entity) : undefined;
  }

  public async findKeyForUpdate(
    apiClientId: string,
    keyId: string,
    transaction: EntityManager,
  ): Promise<StoredApiClientKey | undefined> {
    const entity = await transaction.getRepository(ApiClientKeyEntity).findOne({
      where: { id: keyId, apiClientId },
      lock: { mode: 'pessimistic_write' },
    });

    return entity ? toStoredKey(entity) : undefined;
  }

  public async markKeyReplaced(
    keyId: string,
    replacementKeyId: string,
    graceExpiresAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(ApiClientKeyEntity).update(
      { id: keyId },
      {
        replacedByKeyId: replacementKeyId,
        graceExpiresAt,
      },
    );
  }

  public async insertKey(key: StoredApiClientKey, transaction: EntityManager): Promise<void> {
    await transaction.getRepository(ApiClientKeyEntity).insert({
      id: key.id,
      apiClientId: key.apiClientId,
      keyPrefix: key.keyPrefix,
      secretDigest: key.secretDigest,
      createdAt: key.createdAt,
      expiresAt: key.expiresAt ?? null,
      graceExpiresAt: key.graceExpiresAt ?? null,
      replacedByKeyId: key.replacedByKeyId ?? null,
      revokedAt: key.revokedAt ?? null,
      lastUsedAt: key.lastUsedAt ?? null,
    });
  }

  public async revokeKey(
    keyId: string,
    revokedAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction
      .getRepository(ApiClientKeyEntity)
      .createQueryBuilder()
      .update(ApiClientKeyEntity)
      .set({ revokedAt })
      .where('id = :keyId', { keyId })
      .andWhere('revoked_at IS NULL')
      .execute();
  }

  public async findAuthenticationRecord(
    keyId: string,
  ): Promise<ApiClientAuthenticationRecord | undefined> {
    const keyEntity = await this.dataSource
      .getRepository(ApiClientKeyEntity)
      .findOne({ where: { id: keyId } });

    if (!keyEntity) {
      return undefined;
    }

    const clientEntity = await this.dataSource
      .getRepository(ApiClientEntity)
      .findOne({ where: { id: keyEntity.apiClientId } });

    if (!clientEntity) {
      return undefined;
    }

    const [client] = await this.hydrateClients([clientEntity], this.dataSource.manager);

    return client ? toAuthenticationRecord(client, keyEntity) : undefined;
  }

  public async findSiteByKey(
    workspaceId: string,
    siteKey: string,
  ): Promise<ApiClientSiteContext | undefined> {
    const site = await this.dataSource.getRepository(SiteEntity).findOne({
      where: { workspaceId, key: siteKey },
    });

    if (!site) {
      return undefined;
    }

    const domain = await this.dataSource.getRepository(SiteDomainEntity).findOne({
      where: { workspaceId, siteId: site.id, kind: 'canonical' },
    });

    return {
      id: site.id,
      workspaceId: site.workspaceId,
      key: site.key,
      name: site.name,
      type: site.type,
      status: site.status,
      timezone: site.timezone,
      locale: site.locale,
      canonicalHostname: domain?.hostname,
    };
  }

  public async touchKeyUsage(
    keyId: string,
    usedAt: Date,
    minimumPreviousUsage: Date,
  ): Promise<void> {
    await this.dataSource
      .getRepository(ApiClientKeyEntity)
      .createQueryBuilder()
      .update(ApiClientKeyEntity)
      .set({ lastUsedAt: usedAt })
      .where('id = :keyId', { keyId })
      .andWhere('(last_used_at IS NULL OR last_used_at < :minimumPreviousUsage)', {
        minimumPreviousUsage,
      })
      .execute();
  }

  private async hydrateClients(
    entities: readonly ApiClientEntity[],
    manager: EntityManager,
  ): Promise<ApiClientRecord[]> {
    if (entities.length === 0) {
      return [];
    }

    const ids = entities.map((entity) => entity.id);
    const [siteAccess, scopes, origins, keys] = await Promise.all([
      manager.getRepository(ApiClientSiteAccessEntity).find({
        where: { apiClientId: In(ids) },
      }),
      manager.getRepository(ApiClientScopeEntity).find({
        where: { apiClientId: In(ids) },
      }),
      manager.getRepository(ApiClientAllowedOriginEntity).find({
        where: { apiClientId: In(ids) },
      }),
      manager.getRepository(ApiClientKeyEntity).find({
        where: { apiClientId: In(ids) },
        order: { createdAt: 'DESC' },
      }),
    ]);

    return entities.map((entity) => ({
      id: entity.id,
      workspaceId: entity.workspaceId,
      name: entity.name,
      description: entity.description ?? undefined,
      type: entity.type,
      status: entity.status,
      rateLimitPerMinute: entity.rateLimitPerMinute,
      requireOrigin: entity.requireOrigin,
      version: entity.version,
      siteIds: siteAccess
        .filter((item) => item.apiClientId === entity.id)
        .map((item) => item.siteId)
        .sort(),
      scopes: scopes
        .filter((item) => item.apiClientId === entity.id)
        .map((item) => item.scope)
        .sort(),
      allowedOrigins: origins
        .filter((item) => item.apiClientId === entity.id)
        .map((item) => item.origin)
        .sort(),
      keys: keys.filter((item) => item.apiClientId === entity.id).map(toPublicKey),
      disabledAt: entity.disabledAt ? new Date(entity.disabledAt) : undefined,
      archivedAt: entity.archivedAt ? new Date(entity.archivedAt) : undefined,
      createdAt: new Date(entity.createdAt),
      updatedAt: new Date(entity.updatedAt),
    }));
  }
}

function toStoredKey(entity: ApiClientKeyEntity): StoredApiClientKey {
  return {
    id: entity.id,
    apiClientId: entity.apiClientId,
    keyPrefix: entity.keyPrefix,
    secretDigest: entity.secretDigest,
    createdAt: new Date(entity.createdAt),
    expiresAt: entity.expiresAt ? new Date(entity.expiresAt) : undefined,
    graceExpiresAt: entity.graceExpiresAt ? new Date(entity.graceExpiresAt) : undefined,
    replacedByKeyId: entity.replacedByKeyId ?? undefined,
    revokedAt: entity.revokedAt ? new Date(entity.revokedAt) : undefined,
    lastUsedAt: entity.lastUsedAt ? new Date(entity.lastUsedAt) : undefined,
  };
}

function toPublicKey(entity: ApiClientKeyEntity): ApiClientKeyRecord {
  const { secretDigest: _secretDigest, ...record } = toStoredKey(entity);
  return record;
}

function toAuthenticationRecord(
  client: ApiClientRecord,
  key: ApiClientKeyEntity,
): ApiClientAuthenticationRecord {
  return {
    clientId: client.id,
    workspaceId: client.workspaceId,
    type: client.type,
    status: client.status,
    rateLimitPerMinute: client.rateLimitPerMinute,
    requireOrigin: client.requireOrigin,
    siteIds: client.siteIds,
    scopes: client.scopes,
    allowedOrigins: client.allowedOrigins,
    key: toStoredKey(key),
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}
