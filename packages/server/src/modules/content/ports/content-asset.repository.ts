import type { AssetUsageRecord, ContentAssetTargetRecord } from '../domain/content-asset';

export interface ContentAssetRepositoryPort<TTransaction = unknown> {
  findTargets(
    workspaceId: string,
    assetIds: readonly string[],
    transaction: TTransaction,
  ): Promise<readonly ContentAssetTargetRecord[]>;
  insertRevisionUsages(
    usages: readonly AssetUsageRecord[],
    transaction: TTransaction,
  ): Promise<void>;
  listRevisionUsages(workspaceId: string, revisionId: string): Promise<readonly AssetUsageRecord[]>;
}
