import type { AssetRecord } from '../domain/asset';
import type { AssetProcessingAttemptRecord, AssetVariantRecord } from '../domain/asset-processing';

export interface ClaimAssetProcessingInput {
  attemptId: string;
  jobId: string;
  startedAt: Date;
  staleBefore: Date;
}

export type ClaimAssetProcessingResult =
  | Readonly<{ kind: 'already-ready'; asset: AssetRecord; variants: readonly AssetVariantRecord[] }>
  | Readonly<{ kind: 'busy'; asset: AssetRecord }>
  | Readonly<{
      kind: 'claimed';
      asset: AssetRecord;
      attempt: AssetProcessingAttemptRecord;
    }>
  | Readonly<{ kind: 'missing' }>
  | Readonly<{ kind: 'not-processable'; asset: AssetRecord }>;

export interface CompleteAssetProcessingInput {
  attemptId: string;
  width: number;
  height: number;
  variants: readonly AssetVariantRecord[];
  completedAt: Date;
}

export interface FailAssetProcessingInput {
  attemptId: string;
  failureCode: string;
  finalAttempt: boolean;
  failedAt: Date;
}

export interface AssetProcessingRepositoryPort<TTransaction = unknown> {
  findVariants(workspaceId: string, assetId: string): Promise<readonly AssetVariantRecord[]>;
  claim(
    workspaceId: string,
    assetId: string,
    input: ClaimAssetProcessingInput,
    transaction: TTransaction,
  ): Promise<ClaimAssetProcessingResult>;
  complete(
    workspaceId: string,
    assetId: string,
    input: CompleteAssetProcessingInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  fail(
    workspaceId: string,
    assetId: string,
    input: FailAssetProcessingInput,
    transaction: TTransaction,
  ): Promise<boolean>;
}
