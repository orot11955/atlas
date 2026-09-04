import type { AssetRecord } from '../domain/asset';
import type { AssetUsageViewRecord } from '../domain/asset-lifecycle';

export interface AssetLifecycleRepositoryPort<TTransaction = unknown> {
  findForUpdate(
    workspaceId: string,
    assetId: string,
    transaction: TTransaction,
  ): Promise<AssetRecord | undefined>;
  countActivePublicationUsages(
    workspaceId: string,
    assetId: string,
    transaction: TTransaction,
  ): Promise<number>;
  archive(
    workspaceId: string,
    assetId: string,
    expectedVersion: number,
    archivedAt: Date,
    transaction: TTransaction,
  ): Promise<boolean>;
  listUsages(workspaceId: string, assetId: string): Promise<readonly AssetUsageViewRecord[]>;
}
