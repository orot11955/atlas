import { In, type DataSource, type EntityManager } from 'typeorm';

import type {
  AssetUsageRecord,
  ContentAssetPublicationSourceRecord,
  ContentAssetTargetRecord,
} from '../../domain/content-asset';
import type { ContentAssetRepositoryPort } from '../../ports/content-asset.repository';
import { AssetVariantEntity } from '../../../media/infrastructure/persistence/asset-processing.entities';
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

    const uniqueAssetIds = [...new Set(assetIds)].sort();
    const assets = await transaction
      .getRepository(AssetEntity)
      .createQueryBuilder('asset')
      .setLock('pessimistic_read')
      .where('asset.workspace_id = :workspaceId', { workspaceId })
      .andWhere('asset.id IN (:...assetIds)', { assetIds: uniqueAssetIds })
      .orderBy('asset.id', 'ASC')
      .getMany();

    return assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      status: asset.status,
      archivedAt: asset.archivedAt ? new Date(asset.archivedAt) : undefined,
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

    return entities.map(toAssetUsageRecord);
  }

  public async listRevisionPublicationSources(
    workspaceId: string,
    revisionId: string,
    transaction: EntityManager,
  ): Promise<readonly ContentAssetPublicationSourceRecord[]> {
    const usages = await transaction.getRepository(AssetUsageEntity).find({
      where: { workspaceId, revisionId },
      order: { ordinal: 'ASC' },
    });

    if (usages.length === 0) {
      return [];
    }

    const assetIds = [...new Set(usages.map((usage) => usage.assetId))].sort();
    const assets = await transaction
      .getRepository(AssetEntity)
      .createQueryBuilder('asset')
      .setLock('pessimistic_read')
      .where('asset.workspace_id = :workspaceId', { workspaceId })
      .andWhere('asset.id IN (:...assetIds)', { assetIds })
      .orderBy('asset.id', 'ASC')
      .getMany();
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const variants = await transaction.getRepository(AssetVariantEntity).find({
      where: {
        workspaceId,
        assetId: In(assetIds),
      },
    });
    const variantsByAssetId = new Map<string, typeof variants>();

    for (const variant of variants) {
      const entries = variantsByAssetId.get(variant.assetId) ?? [];
      entries.push(variant);
      variantsByAssetId.set(variant.assetId, entries);
    }

    return usages.map((usage) => {
      const asset = assetsById.get(usage.assetId);

      return {
        usage: toAssetUsageRecord(usage),
        ...(asset
          ? {
              asset: {
                id: asset.id,
                kind: asset.kind,
                status: asset.status,
                archivedAt: asset.archivedAt ? new Date(asset.archivedAt) : undefined,
              },
            }
          : {}),
        variants: (variantsByAssetId.get(usage.assetId) ?? []).map((variant) => ({
          id: variant.id,
          workspaceId: variant.workspaceId,
          assetId: variant.assetId,
          key: variant.key,
          format: variant.format,
          contentType: variant.contentType,
          width: variant.width,
          height: variant.height,
          byteSize: variant.byteSize,
          sha256: variant.sha256,
          objectKey: variant.objectKey,
          etag: variant.etag,
          createdAt: variant.createdAt,
        })),
      };
    });
  }
}

function toAssetUsageRecord(entity: AssetUsageEntity): AssetUsageRecord {
  return {
    id: entity.id,
    workspaceId: entity.workspaceId,
    assetId: entity.assetId,
    revisionId: entity.revisionId,
    ordinal: entity.ordinal,
    kind: entity.kind,
    altText: entity.altText,
    caption: entity.caption ?? undefined,
    createdAt: entity.createdAt,
  };
}
