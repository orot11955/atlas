import { In, type DataSource, type EntityManager, type Repository } from 'typeorm';

import type { SiteCanonicalDomain, SiteRecord } from '../../domain/site';
import type {
  InsertSiteRecordInput,
  SiteListRepositoryQuery,
  SiteRepositoryPort,
  UpdateSiteRecordInput,
  UpdateSiteStatusRecordInput,
} from '../../ports/site.repository';
import { SiteDomainEntity } from './site-domain.entity';
import { SiteSettingsEntity } from './site-settings.entity';
import { SiteEntity } from './site.entity';

export class TypeOrmSiteRepository implements SiteRepositoryPort<EntityManager> {
  public constructor(private readonly dataSource: DataSource) {}

  public async list(
    workspaceId: string,
    query: SiteListRepositoryQuery,
  ): Promise<readonly SiteRecord[]> {
    const builder = this.dataSource
      .getRepository(SiteEntity)
      .createQueryBuilder('site')
      .where('site.workspace_id = :workspaceId', { workspaceId });

    if (query.status) {
      builder.andWhere('site.status = :status', { status: query.status });
    }

    if (query.type) {
      builder.andWhere('site.type = :type', { type: query.type });
    }

    if (query.search) {
      builder.andWhere('(site.name ILIKE :search OR site.key ILIKE :search)', {
        search: `%${escapeLike(query.search)}%`,
      });
    }

    if (query.cursor) {
      builder.andWhere(
        '(site.created_at < :cursorCreatedAt OR (site.created_at = :cursorCreatedAt AND site.id < :cursorId))',
        {
          cursorCreatedAt: query.cursor.createdAt,
          cursorId: query.cursor.id,
        },
      );
    }

    const entities = await builder
      .orderBy('site.created_at', 'DESC')
      .addOrderBy('site.id', 'DESC')
      .take(query.limit)
      .getMany();

    return this.attachCanonicalDomains(entities, this.dataSource.manager);
  }

  public async findById(
    workspaceId: string,
    siteId: string,
    transaction?: EntityManager,
  ): Promise<SiteRecord | undefined> {
    const manager = transaction ?? this.dataSource.manager;
    const entity = await manager.getRepository(SiteEntity).findOne({
      where: { id: siteId, workspaceId },
    });

    if (!entity) {
      return undefined;
    }

    const [record] = await this.attachCanonicalDomains([entity], manager);
    return record;
  }

  public async findByKey(
    workspaceId: string,
    key: string,
    transaction?: EntityManager,
  ): Promise<SiteRecord | undefined> {
    const manager = transaction ?? this.dataSource.manager;
    const entity = await manager.getRepository(SiteEntity).findOne({
      where: { workspaceId, key },
    });

    if (!entity) {
      return undefined;
    }

    const [record] = await this.attachCanonicalDomains([entity], manager);
    return record;
  }

  public async findCanonicalDomainOwner(
    workspaceId: string,
    hostname: string,
    transaction?: EntityManager,
  ): Promise<string | undefined> {
    const entity = await (transaction ?? this.dataSource.manager)
      .getRepository(SiteDomainEntity)
      .findOne({
        where: { workspaceId, hostname },
        select: { id: true, siteId: true },
      });

    return entity?.siteId;
  }

  public async insert(
    site: InsertSiteRecordInput,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(SiteEntity).insert({
      id: site.id,
      workspaceId: site.workspaceId,
      key: site.key,
      name: site.name,
      description: site.description ?? null,
      type: site.type,
      status: site.status,
      timezone: site.timezone,
      locale: site.locale,
      version: site.version,
      archivedAt: site.archivedAt ?? null,
      createdAt: site.createdAt,
      updatedAt: site.updatedAt,
    });
    await transaction.getRepository(SiteSettingsEntity).insert({
      siteId: site.id,
      workspaceId: site.workspaceId,
      brandingJson: {},
      seoDefaultsJson: {},
      version: 1,
      updatedAt: site.createdAt,
    });

    if (site.canonicalDomain) {
      await transaction.getRepository(SiteDomainEntity).insert({
        id: site.canonicalDomain.id,
        workspaceId: site.workspaceId,
        siteId: site.id,
        hostname: site.canonicalDomain.hostname,
        kind: 'canonical',
        verificationStatus: site.canonicalDomain.verificationStatus,
        verificationTokenDigest: null,
        verifiedAt: site.canonicalDomain.verifiedAt ?? null,
        createdAt: site.createdAt,
        updatedAt: site.createdAt,
      });
    }
  }

  public async update(
    workspaceId: string,
    siteId: string,
    input: UpdateSiteRecordInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(SiteEntity).update(
      { id: siteId, workspaceId, version: input.expectedVersion },
      {
        name: input.name,
        description: input.description ?? null,
        type: input.type,
        timezone: input.timezone,
        locale: input.locale,
        version: input.nextVersion,
        updatedAt: input.updatedAt,
      },
    );

    return (result.affected ?? 0) === 1;
  }

  public async replaceCanonicalDomain(
    workspaceId: string,
    siteId: string,
    domain: SiteCanonicalDomain | undefined,
    updatedAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(SiteDomainEntity).delete({
      workspaceId,
      siteId,
      kind: 'canonical',
    });

    if (!domain) {
      return;
    }

    await transaction.getRepository(SiteDomainEntity).insert({
      id: domain.id,
      workspaceId,
      siteId,
      hostname: domain.hostname,
      kind: 'canonical',
      verificationStatus: domain.verificationStatus,
      verificationTokenDigest: null,
      verifiedAt: domain.verifiedAt ?? null,
      createdAt: updatedAt,
      updatedAt,
    });
  }

  public async updateStatus(
    workspaceId: string,
    siteId: string,
    input: UpdateSiteStatusRecordInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(SiteEntity).update(
      { id: siteId, workspaceId, version: input.expectedVersion },
      {
        status: input.status,
        version: input.nextVersion,
        archivedAt: input.archivedAt ?? null,
        updatedAt: input.updatedAt,
      },
    );

    return (result.affected ?? 0) === 1;
  }

  private async attachCanonicalDomains(
    entities: readonly SiteEntity[],
    manager: EntityManager,
  ): Promise<SiteRecord[]> {
    if (entities.length === 0) {
      return [];
    }

    const domains = await manager.getRepository(SiteDomainEntity).find({
      where: {
        siteId: In(entities.map((entity) => entity.id)),
        kind: 'canonical',
      },
    });
    const domainsBySiteId = new Map(
      domains.map((domain) => [domain.siteId, toCanonicalDomain(domain)]),
    );

    return entities.map((entity) =>
      toSiteRecord(entity, domainsBySiteId.get(entity.id)),
    );
  }
}

function toSiteRecord(
  entity: SiteEntity,
  canonicalDomain?: SiteCanonicalDomain,
): SiteRecord {
  return {
    id: entity.id,
    workspaceId: entity.workspaceId,
    key: entity.key,
    name: entity.name,
    description: entity.description ?? undefined,
    type: entity.type,
    status: entity.status,
    timezone: entity.timezone,
    locale: entity.locale,
    version: entity.version,
    canonicalDomain,
    archivedAt: entity.archivedAt ? new Date(entity.archivedAt) : undefined,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

function toCanonicalDomain(entity: SiteDomainEntity): SiteCanonicalDomain {
  return {
    id: entity.id,
    hostname: entity.hostname,
    verificationStatus: entity.verificationStatus,
    verifiedAt: entity.verifiedAt ? new Date(entity.verifiedAt) : undefined,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}
