import { In, type DataSource, type EntityManager } from 'typeorm';

import type { AssetUsageRecord, ContentAssetTargetRecord } from '../../domain/content-asset';
import type { ContentAssetRepositoryPort } from '../../ports/content-asset.repository';
import { AssetEntity } from '../../../media/infrastructure/persistence/asset.entities';
import { AssetUsageEntity } from './content-asset.entities';

export class TypeOrmContentAssetRepository implements ContentAssetRepositoryPort<EntityManager> {
  public constructor(private readonly dataSource: DataSource) {}

  public async findTargets(
    workspaceId: string,
    assetIds: readonly string[],
    transaction: EntityManager,
  ): Promise<readonly ContentAssetTargetRecord[]> {
    if (assetIds.length === 0) {
      return [];
    }

    const assets = await transaction.getRepository(AssetEntity).find({
      where: {
        workspaceId,
        id: In([...new Set(assetIds)]),
      },
    });

    return assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      status: asset.status,
    }));
  }

  public async insertRevisionUsages(
    usages: readonly AssetUsageRecord[],
    transaction: EntityManager,
  ): Promise<void> {
    if (usages.length === 0) {
      return;
    }

    await transaction.getRepository(AssetUsageEntity).insert(
      usages.map((usage) => ({
        id: usage.id,
        workspaceId: usage.workspaceId,
        assetId: usage.assetId,
        revisionId: usage.revisionId,
        ordinal: usage.ordinal,
        kind: usage.kind,
        altText: usage.altText,
        caption: usage.caption ?? null,
        createdAt: usage.createdAt,
      })),
    );
  }

  public async listRevisionUsages(
    workspaceId: string,
    revisionId: string,
  ): Promise<readonly AssetUsageRecord[]> {
    const entities = await this.dataSource.getRepository(AssetUsageEntity).find({
      where: { workspaceId, revisionId },
      order: { ordinal: 'ASC' },
    });

    return entities.map((entity) => ({
      id: entity.id,
      workspaceId: entity.workspaceId,
      assetId: entity.assetId,
      revisionId: entity.revisionId,
      ordinal: entity.ordinal,
      kind: entity.kind,
      altText: entity.altText,
      caption: entity.caption ?? undefined,
      createdAt: entity.createdAt,
    }));
  }
}
