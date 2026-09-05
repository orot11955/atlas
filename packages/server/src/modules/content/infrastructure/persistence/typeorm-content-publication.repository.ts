import type { DataSource, EntityManager } from 'typeorm';

import { freezeContentPublicationAssetManifest } from '../../domain/content-asset';
import { ContentRevisionKind } from '../../domain/content';
import {
  CONTENT_DELIVERY_SCHEMA_VERSION,
  ContentPublicationStatus,
  type ContentPublicationRecord,
  type ContentSiteRecord,
  type ContentSiteTargetRecord,
  type DeliveryContentRecord,
  type PublishableContentRecord,
} from '../../domain/content-publication';
import type {
  ContentPublicationRepositoryPort,
  DeliveryContentRepositoryListQuery,
  InsertContentPublicationInput,
  InsertContentSiteInput,
  UpdateContentSiteRecordInput,
} from '../../ports/content-publication.repository';
import { SiteEntity } from '../../../site/infrastructure/persistence/site.entity';
import { ContentEntity, ContentRevisionEntity } from './content.entities';
import { ContentPublicationEntity, ContentSiteEntity } from './content-publication.entities';

export class TypeOrmContentPublicationRepository implements ContentPublicationRepositoryPort<EntityManager> {
  public constructor(private readonly dataSource: DataSource) {}

  public async listContentSites(
    workspaceId: string,
    contentId: string,
  ): Promise<readonly ContentSiteRecord[]> {
    const rows = (await this.dataSource.query(
      `SELECT
         cs.*,
         site.key AS site_key,
         site.name AS site_name,
         site.status AS site_status,
         publication.id AS active_publication_id,
         publication.revision_id AS active_revision_id,
         publication.revision_number AS active_revision_number,
         publication.status AS active_publication_status,
         publication.etag AS active_publication_etag,
         publication.published_at AS active_publication_published_at
       FROM content_sites cs
       INNER JOIN sites site
         ON site.id = cs.site_id
        AND site.workspace_id = cs.workspace_id
       LEFT JOIN content_publications publication
         ON publication.content_site_id = cs.id
        AND publication.workspace_id = cs.workspace_id
        AND publication.status = 'active'
       WHERE cs.workspace_id = $1
         AND cs.content_id = $2
       ORDER BY cs.created_at ASC, cs.id ASC`,
      [workspaceId, contentId],
    )) as ContentSiteRow[];

    return rows.map(toContentSiteRecord);
  }

  public async findContentSite(
    workspaceId: string,
    contentId: string,
    contentSiteId: string,
    transaction?: EntityManager,
  ): Promise<ContentSiteRecord | undefined> {
    return this.findContentSiteRecord(
      transaction ?? this.dataSource.manager,
      workspaceId,
      contentId,
      contentSiteId,
      false,
    );
  }

  public async findContentSiteForUpdate(
    workspaceId: string,
    contentId: string,
    contentSiteId: string,
    transaction: EntityManager,
  ): Promise<ContentSiteRecord | undefined> {
    return this.findContentSiteRecord(transaction, workspaceId, contentId, contentSiteId, true);
  }

  public async findContentStatus(
    workspaceId: string,
    contentId: string,
    transaction?: EntityManager,
  ) {
    const manager = transaction ?? this.dataSource.manager;
    const builder = manager
      .getRepository(ContentEntity)
      .createQueryBuilder('content')
      .select(['content.id', 'content.status'])
      .where('content.id = :contentId', { contentId })
      .andWhere('content.workspace_id = :workspaceId', { workspaceId });

    if (transaction) {
      builder.setLock('pessimistic_write');
    }

    const content = await builder.getOne();
    return content?.status;
  }

  public async findSiteTarget(
    workspaceId: string,
    siteId: string,
    transaction?: EntityManager,
  ): Promise<ContentSiteTargetRecord | undefined> {
    const site = await (transaction ?? this.dataSource.manager).getRepository(SiteEntity).findOne({
      where: { id: siteId, workspaceId },
      select: { id: true, workspaceId: true, key: true, name: true, status: true },
    });

    return site
      ? {
          id: site.id,
          workspaceId: site.workspaceId,
          key: site.key,
          name: site.name,
          status: site.status,
        }
      : undefined;
  }

  public async insertContentSite(
    input: InsertContentSiteInput,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(ContentSiteEntity).insert({
      id: input.id,
      workspaceId: input.workspaceId,
      contentId: input.contentId,
      siteId: input.siteId,
      slug: input.slug,
      titleOverride: input.titleOverride ?? null,
      summaryOverride: input.summaryOverride ?? null,
      seoJson: { ...input.seo } as never,
      visibility: input.visibility,
      version: input.version,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });
  }

  public async updateContentSite(
    workspaceId: string,
    contentId: string,
    contentSiteId: string,
    input: UpdateContentSiteRecordInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(ContentSiteEntity).update(
      {
        id: contentSiteId,
        workspaceId,
        contentId,
        version: input.expectedVersion,
      },
      {
        slug: input.slug,
        titleOverride: input.titleOverride ?? null,
        summaryOverride: input.summaryOverride ?? null,
        seoJson: { ...input.seo } as never,
        visibility: input.visibility,
        version: input.nextVersion,
        updatedAt: input.updatedAt,
      },
    );

    return (result.affected ?? 0) === 1;
  }

  public async findPublishableContentForUpdate(
    workspaceId: string,
    contentId: string,
    transaction: EntityManager,
  ): Promise<PublishableContentRecord | undefined> {
    const content = await transaction
      .getRepository(ContentEntity)
      .createQueryBuilder('content')
      .setLock('pessimistic_write')
      .where('content.id = :contentId', { contentId })
      .andWhere('content.workspace_id = :workspaceId', { workspaceId })
      .getOne();

    if (!content) {
      return undefined;
    }

    const revision = content.readyRevisionNumber
      ? await transaction.getRepository(ContentRevisionEntity).findOne({
          where: {
            workspaceId,
            contentId,
            revisionNumber: content.readyRevisionNumber,
            kind: ContentRevisionKind.READY,
          },
        })
      : undefined;

    return {
      id: content.id,
      workspaceId: content.workspaceId,
      type: content.type,
      status: content.status,
      readyRevisionNumber: content.readyRevisionNumber ?? undefined,
      ...(revision
        ? {
            revision: {
              id: revision.id,
              contentId: revision.contentId,
              workspaceId: revision.workspaceId,
              revisionNumber: revision.revisionNumber,
              kind: revision.kind,
              title: revision.title,
              summary: revision.summary ?? undefined,
              bodyMarkdown: revision.bodyMarkdown,
              bodyHtml: revision.bodyHtml,
              sourceDraftVersion: revision.sourceDraftVersion,
              note: revision.note ?? undefined,
              createdByAdminAccountId: revision.createdByAdminAccountId,
              createdAt: new Date(revision.createdAt),
            },
          }
        : {}),
    };
  }

  public async findPublishableRevisionForUpdate(
    workspaceId: string,
    contentId: string,
    revisionId: string,
    transaction: EntityManager,
  ): Promise<PublishableContentRecord | undefined> {
    const content = await transaction
      .getRepository(ContentEntity)
      .createQueryBuilder('content')
      .setLock('pessimistic_write')
      .where('content.id = :contentId', { contentId })
      .andWhere('content.workspace_id = :workspaceId', { workspaceId })
      .getOne();

    if (!content) {
      return undefined;
    }

    const revision = await transaction.getRepository(ContentRevisionEntity).findOne({
      where: {
        id: revisionId,
        workspaceId,
        contentId,
        kind: ContentRevisionKind.READY,
      },
    });

    return {
      id: content.id,
      workspaceId: content.workspaceId,
      type: content.type,
      status: content.status,
      readyRevisionNumber: content.readyRevisionNumber ?? undefined,
      ...(revision
        ? {
            revision: {
              id: revision.id,
              contentId: revision.contentId,
              workspaceId: revision.workspaceId,
              revisionNumber: revision.revisionNumber,
              kind: revision.kind,
              title: revision.title,
              summary: revision.summary ?? undefined,
              bodyMarkdown: revision.bodyMarkdown,
              bodyHtml: revision.bodyHtml,
              sourceDraftVersion: revision.sourceDraftVersion,
              note: revision.note ?? undefined,
              createdByAdminAccountId: revision.createdByAdminAccountId,
              createdAt: new Date(revision.createdAt),
            },
          }
        : {}),
    };
  }

  public async findActivePublication(
    workspaceId: string,
    contentSiteId: string,
    transaction?: EntityManager,
  ): Promise<ContentPublicationRecord | undefined> {
    const entity = await (transaction ?? this.dataSource.manager)
      .getRepository(ContentPublicationEntity)
      .findOne({
        where: {
          workspaceId,
          contentSiteId,
          status: ContentPublicationStatus.ACTIVE,
        },
      });

    return entity ? toContentPublicationRecord(entity) : undefined;
  }

  public async findActiveSlugOwner(
    workspaceId: string,
    siteId: string,
    slug: string,
    transaction: EntityManager,
  ): Promise<string | undefined> {
    const entity = await transaction.getRepository(ContentPublicationEntity).findOne({
      where: {
        workspaceId,
        siteId,
        slug,
        status: ContentPublicationStatus.ACTIVE,
      },
      select: { id: true, contentSiteId: true },
    });

    return entity?.contentSiteId;
  }

  public async supersedeActivePublication(
    workspaceId: string,
    contentSiteId: string,
    supersededAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(ContentPublicationEntity).update(
      {
        workspaceId,
        contentSiteId,
        status: ContentPublicationStatus.ACTIVE,
      },
      {
        status: ContentPublicationStatus.SUPERSEDED,
        supersededAt,
      },
    );
  }

  public async insertPublication(
    input: InsertContentPublicationInput,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(ContentPublicationEntity).insert({
      id: input.id,
      workspaceId: input.workspaceId,
      contentSiteId: input.contentSiteId,
      contentId: input.contentId,
      contentType: input.contentType,
      siteId: input.siteId,
      siteKey: input.siteKey,
      siteName: input.siteName,
      revisionId: input.revisionId,
      revisionNumber: input.revisionNumber,
      status: input.status,
      slug: input.slug,
      title: input.title,
      summary: input.summary ?? null,
      bodyHtml: input.bodyHtml,
      assetManifestJson: input.assets.map((asset) => ({
        ...asset,
        variants: asset.variants.map((variant) => ({ ...variant })),
      })),
      seoJson: { ...input.seo } as never,
      visibility: input.visibility,
      etag: input.etag,
      publishedAt: input.publishedAt,
      supersededAt: null,
      withdrawnAt: null,
      createdByAdminAccountId: input.createdByAdminAccountId,
      createdAt: input.createdAt,
    });
  }

  public async withdrawActivePublication(
    workspaceId: string,
    contentSiteId: string,
    withdrawnAt: Date,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(ContentPublicationEntity).update(
      {
        workspaceId,
        contentSiteId,
        status: ContentPublicationStatus.ACTIVE,
      },
      {
        status: ContentPublicationStatus.WITHDRAWN,
        withdrawnAt,
      },
    );

    return (result.affected ?? 0) === 1;
  }

  public async listPublications(
    workspaceId: string,
    contentSiteId: string,
  ): Promise<readonly ContentPublicationRecord[]> {
    const entities = await this.dataSource.getRepository(ContentPublicationEntity).find({
      where: { workspaceId, contentSiteId },
      order: { publishedAt: 'DESC', id: 'DESC' },
      take: 200,
    });

    return entities.map(toContentPublicationRecord);
  }

  public async findPublication(
    workspaceId: string,
    contentSiteId: string,
    publicationId: string,
    transaction?: EntityManager,
  ): Promise<ContentPublicationRecord | undefined> {
    const entity = await (transaction ?? this.dataSource.manager)
      .getRepository(ContentPublicationEntity)
      .findOne({ where: { id: publicationId, workspaceId, contentSiteId } });

    return entity ? toContentPublicationRecord(entity) : undefined;
  }

  public async listDeliveryContent(
    workspaceId: string,
    siteId: string,
    query: DeliveryContentRepositoryListQuery,
  ): Promise<readonly DeliveryContentRecord[]> {
    const builder = this.dataSource
      .getRepository(ContentPublicationEntity)
      .createQueryBuilder('publication')
      .select([
        'publication.id AS publication_id',
        'publication.content_id AS content_id',
        'publication.content_type AS content_type',
        'publication.revision_number AS revision_number',
        'publication.slug AS slug',
        'publication.title AS title',
        'publication.summary AS summary',
        'publication.body_html AS body_html',
        'publication.asset_manifest_json AS asset_manifest_json',
        'publication.seo_json AS seo_json',
        'publication.visibility AS visibility',
        'publication.etag AS etag',
        'publication.published_at AS published_at',
        'publication.site_id AS site_id',
        'publication.site_key AS site_key',
        'publication.site_name AS site_name',
      ])
      .where('publication.workspace_id = :workspaceId', { workspaceId })
      .andWhere('publication.site_id = :siteId', { siteId })
      .andWhere('publication.status = :status', { status: ContentPublicationStatus.ACTIVE })
      .andWhere('publication.visibility = :visibility', { visibility: 'public' });

    if (query.contentType) {
      builder.andWhere('publication.content_type = :contentType', {
        contentType: query.contentType,
      });
    }

    if (query.cursor) {
      builder.andWhere(
        '(publication.published_at < :publishedAt OR (publication.published_at = :publishedAt AND publication.id < :id))',
        { publishedAt: query.cursor.publishedAt, id: query.cursor.id },
      );
    }

    const rows = (await builder
      .orderBy('publication.published_at', 'DESC')
      .addOrderBy('publication.id', 'DESC')
      .take(query.limit)
      .getRawMany()) as DeliveryContentRow[];

    return rows.map(toDeliveryContentRecord);
  }

  public async findDeliveryContentBySlug(
    workspaceId: string,
    siteId: string,
    slug: string,
    contentType?: import('../../domain/content').ContentType,
  ): Promise<DeliveryContentRecord | undefined> {
    const builder = this.dataSource
      .getRepository(ContentPublicationEntity)
      .createQueryBuilder('publication')
      .select([
        'publication.id AS publication_id',
        'publication.content_id AS content_id',
        'publication.content_type AS content_type',
        'publication.revision_number AS revision_number',
        'publication.slug AS slug',
        'publication.title AS title',
        'publication.summary AS summary',
        'publication.body_html AS body_html',
        'publication.asset_manifest_json AS asset_manifest_json',
        'publication.seo_json AS seo_json',
        'publication.visibility AS visibility',
        'publication.etag AS etag',
        'publication.published_at AS published_at',
        'publication.site_id AS site_id',
        'publication.site_key AS site_key',
        'publication.site_name AS site_name',
      ])
      .where('publication.workspace_id = :workspaceId', { workspaceId })
      .andWhere('publication.site_id = :siteId', { siteId })
      .andWhere('publication.status = :status', { status: ContentPublicationStatus.ACTIVE })
      .andWhere('publication.visibility <> :privateVisibility', {
        privateVisibility: 'private',
      })
      .andWhere('publication.slug = :slug', { slug });

    if (contentType) {
      builder.andWhere('publication.content_type = :contentType', { contentType });
    }

    const row = (await builder.getRawOne()) as DeliveryContentRow | undefined;
    return row ? toDeliveryContentRecord(row) : undefined;
  }

  private async findContentSiteRecord(
    manager: EntityManager,
    workspaceId: string,
    contentId: string,
    contentSiteId: string,
    lock: boolean,
  ): Promise<ContentSiteRecord | undefined> {
    const rows = (await manager.query(
      `SELECT
         cs.*,
         site.key AS site_key,
         site.name AS site_name,
         site.status AS site_status,
         publication.id AS active_publication_id,
         publication.revision_id AS active_revision_id,
         publication.revision_number AS active_revision_number,
         publication.status AS active_publication_status,
         publication.etag AS active_publication_etag,
         publication.published_at AS active_publication_published_at
       FROM content_sites cs
       INNER JOIN sites site
         ON site.id = cs.site_id
        AND site.workspace_id = cs.workspace_id
       LEFT JOIN content_publications publication
         ON publication.content_site_id = cs.id
        AND publication.workspace_id = cs.workspace_id
        AND publication.status = 'active'
       WHERE cs.id = $1
         AND cs.workspace_id = $2
         AND cs.content_id = $3
       ${lock ? 'FOR UPDATE OF cs' : ''}`,
      [contentSiteId, workspaceId, contentId],
    )) as ContentSiteRow[];

    return rows[0] ? toContentSiteRecord(rows[0]) : undefined;
  }
}

interface ContentSiteRow {
  id: string;
  workspace_id: string;
  content_id: string;
  site_id: string;
  site_key: string;
  site_name: string;
  site_status: string;
  slug: string;
  title_override: string | null;
  summary_override: string | null;
  seo_json: Record<string, unknown> | null;
  visibility: ContentSiteRecord['visibility'];
  version: number;
  active_publication_id: string | null;
  active_revision_id: string | null;
  active_revision_number: number | null;
  active_publication_status: ContentPublicationRecord['status'] | null;
  active_publication_etag: string | null;
  active_publication_published_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DeliveryContentRow {
  publication_id: string;
  content_id: string;
  content_type: DeliveryContentRecord['contentType'];
  revision_number: number;
  slug: string;
  title: string;
  summary: string | null;
  body_html: string;
  asset_manifest_json: DeliveryContentRecord['assets'] | null;
  seo_json: Record<string, unknown> | null;
  visibility: DeliveryContentRecord['visibility'];
  etag: string;
  published_at: Date | string;
  site_id: string;
  site_key: string;
  site_name: string;
}

function toContentSiteRecord(row: ContentSiteRow): ContentSiteRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    contentId: row.content_id,
    siteId: row.site_id,
    siteKey: row.site_key,
    siteName: row.site_name,
    siteStatus: row.site_status,
    slug: row.slug,
    titleOverride: row.title_override ?? undefined,
    summaryOverride: row.summary_override ?? undefined,
    seo: Object.freeze({ ...(row.seo_json ?? {}) }),
    visibility: row.visibility,
    version: row.version,
    ...(row.active_publication_id &&
    row.active_revision_id &&
    row.active_revision_number &&
    row.active_publication_status &&
    row.active_publication_etag &&
    row.active_publication_published_at
      ? {
          activePublication: Object.freeze({
            id: row.active_publication_id,
            revisionId: row.active_revision_id,
            revisionNumber: row.active_revision_number,
            status: row.active_publication_status,
            etag: row.active_publication_etag,
            publishedAt: toDate(row.active_publication_published_at),
          }),
        }
      : {}),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toContentPublicationRecord(entity: ContentPublicationEntity): ContentPublicationRecord {
  return {
    id: entity.id,
    workspaceId: entity.workspaceId,
    contentSiteId: entity.contentSiteId,
    contentId: entity.contentId,
    contentType: entity.contentType,
    siteId: entity.siteId,
    siteKey: entity.siteKey,
    siteName: entity.siteName,
    revisionId: entity.revisionId,
    revisionNumber: entity.revisionNumber,
    status: entity.status,
    slug: entity.slug,
    title: entity.title,
    summary: entity.summary ?? undefined,
    bodyHtml: entity.bodyHtml,
    assets: freezeContentPublicationAssetManifest(entity.assetManifestJson ?? []),
    seo: Object.freeze({ ...(entity.seoJson ?? {}) }),
    visibility: entity.visibility,
    etag: entity.etag,
    publishedAt: new Date(entity.publishedAt),
    supersededAt: entity.supersededAt ? new Date(entity.supersededAt) : undefined,
    withdrawnAt: entity.withdrawnAt ? new Date(entity.withdrawnAt) : undefined,
    createdByAdminAccountId: entity.createdByAdminAccountId,
    createdAt: new Date(entity.createdAt),
  };
}

function toDeliveryContentRecord(row: DeliveryContentRow): DeliveryContentRecord {
  return {
    schemaVersion: CONTENT_DELIVERY_SCHEMA_VERSION,
    publicationId: row.publication_id,
    contentId: row.content_id,
    contentType: row.content_type,
    revisionNumber: row.revision_number,
    site: Object.freeze({
      id: row.site_id,
      key: row.site_key,
      name: row.site_name,
    }),
    slug: row.slug,
    title: row.title,
    summary: row.summary ?? undefined,
    bodyHtml: row.body_html,
    assets: freezeContentPublicationAssetManifest(row.asset_manifest_json ?? []),
    seo: Object.freeze({ ...(row.seo_json ?? {}) }),
    visibility: row.visibility,
    etag: row.etag,
    publishedAt: toDate(row.published_at),
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value) : new Date(value);
}
