import type { DataSource, EntityManager } from 'typeorm';

import type { AssetUsageKind } from '../../../content/domain/content-asset';
import type { AssetRecord } from '../../domain/asset';
import type { AssetUsageViewRecord } from '../../domain/asset-lifecycle';
import type { AssetLifecycleRepositoryPort } from '../../ports/asset-lifecycle.repository';
import { AssetEntity } from './asset.entities';

interface AssetUsageRow {
  id: string;
  workspace_id: string;
  asset_id: string;
  content_id: string;
  revision_id: string;
  revision_number: number | string;
  content_title: string;
  usage_kind: AssetUsageKind;
  ordinal: number | string;
  alt_text: string;
  caption: string | null;
  active_publication_count: number | string;
  created_at: Date | string;
}

export class TypeOrmAssetLifecycleRepository implements AssetLifecycleRepositoryPort<EntityManager> {
  public constructor(private readonly dataSource: DataSource) {}

  public async findForUpdate(
    workspaceId: string,
    assetId: string,
    transaction: EntityManager,
  ): Promise<AssetRecord | undefined> {
    const entity = await transaction
      .getRepository(AssetEntity)
      .createQueryBuilder('asset')
      .setLock('pessimistic_write')
      .where('asset.id = :assetId', { assetId })
      .andWhere('asset.workspace_id = :workspaceId', { workspaceId })
      .getOne();

    return entity ? toAssetRecord(entity) : undefined;
  }

  public async countActivePublicationUsages(
    workspaceId: string,
    assetId: string,
    transaction: EntityManager,
  ): Promise<number> {
    const rows = await transaction.query<{ count: number | string }[]>(
      `
        SELECT count(DISTINCT publication.id)::integer AS count
        FROM asset_usages usage
        INNER JOIN content_publications publication
          ON publication.workspace_id = usage.workspace_id
          AND publication.revision_id = usage.revision_id
          AND publication.status = 'active'
        WHERE usage.workspace_id = $1
          AND usage.asset_id = $2
      `,
      [workspaceId, assetId],
    );

    return Number(rows[0]?.count ?? 0);
  }

  public async archive(
    workspaceId: string,
    assetId: string,
    expectedVersion: number,
    archivedAt: Date,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction
      .getRepository(AssetEntity)
      .createQueryBuilder()
      .update(AssetEntity)
      .set({
        archivedAt,
        version: () => 'version + 1',
        updatedAt: archivedAt,
      })
      .where('id = :assetId', { assetId })
      .andWhere('workspace_id = :workspaceId', { workspaceId })
      .andWhere('version = :expectedVersion', { expectedVersion })
      .andWhere('archived_at IS NULL')
      .execute();

    return (result.affected ?? 0) === 1;
  }

  public async listUsages(
    workspaceId: string,
    assetId: string,
  ): Promise<readonly AssetUsageViewRecord[]> {
    const rows = await this.dataSource.query<AssetUsageRow[]>(
      `
        SELECT
          usage.id,
          usage.workspace_id,
          usage.asset_id,
          revision.content_id,
          usage.revision_id,
          revision.revision_number,
          revision.title AS content_title,
          usage.usage_kind,
          usage.ordinal,
          usage.alt_text,
          usage.caption,
          count(DISTINCT publication.id) FILTER (
            WHERE publication.status = 'active'
          )::integer AS active_publication_count,
          usage.created_at
        FROM asset_usages usage
        INNER JOIN content_revisions revision
          ON revision.id = usage.revision_id
          AND revision.workspace_id = usage.workspace_id
        LEFT JOIN content_publications publication
          ON publication.workspace_id = usage.workspace_id
          AND publication.revision_id = usage.revision_id
        WHERE usage.workspace_id = $1
          AND usage.asset_id = $2
        GROUP BY
          usage.id,
          usage.workspace_id,
          usage.asset_id,
          revision.content_id,
          usage.revision_id,
          revision.revision_number,
          revision.title,
          usage.usage_kind,
          usage.ordinal,
          usage.alt_text,
          usage.caption,
          usage.created_at
        ORDER BY usage.created_at DESC, usage.id DESC
      `,
      [workspaceId, assetId],
    );

    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      assetId: row.asset_id,
      contentId: row.content_id,
      revisionId: row.revision_id,
      revisionNumber: Number(row.revision_number),
      contentTitle: row.content_title,
      kind: row.usage_kind,
      ordinal: Number(row.ordinal),
      altText: row.alt_text,
      caption: row.caption ?? undefined,
      activePublicationCount: Number(row.active_publication_count),
      createdAt: new Date(row.created_at),
    }));
  }
}

function toAssetRecord(entity: AssetEntity): AssetRecord {
  return {
    id: entity.id,
    workspaceId: entity.workspaceId,
    kind: entity.kind,
    status: entity.status,
    originalFileName: entity.originalFileName,
    declaredContentType: entity.declaredContentType,
    detectedContentType: entity.detectedContentType ?? undefined,
    expectedSize: entity.expectedSize,
    actualSize: entity.actualSize ?? undefined,
    sha256: entity.sha256,
    originalObjectKey: entity.originalObjectKey,
    originalEtag: entity.originalEtag ?? undefined,
    width: entity.width ?? undefined,
    height: entity.height ?? undefined,
    processingFailureCode: entity.processingFailureCode ?? undefined,
    version: entity.version,
    createdByAdminAccountId: entity.createdByAdminAccountId,
    uploadedAt: entity.uploadedAt ? new Date(entity.uploadedAt) : undefined,
    processedAt: entity.processedAt ? new Date(entity.processedAt) : undefined,
    failedAt: entity.failedAt ? new Date(entity.failedAt) : undefined,
    archivedAt: entity.archivedAt ? new Date(entity.archivedAt) : undefined,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}
