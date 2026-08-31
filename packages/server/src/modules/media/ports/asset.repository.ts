import type {
  AssetImageContentType,
  AssetRecord,
  AssetUploadAggregate,
  AssetUploadSessionRecord,
} from '../domain/asset';

export interface CompleteAssetUploadInput {
  actualSize: number;
  detectedContentType: AssetImageContentType;
  originalEtag: string;
  completedAt: Date;
}

export interface FailAssetUploadInput {
  failureCode: string;
  failedAt: Date;
}

export interface AssetRepositoryPort<TTransaction = unknown> {
  list(workspaceId: string, limit: number): Promise<readonly AssetRecord[]>;
  findById(workspaceId: string, assetId: string): Promise<AssetRecord | undefined>;
  insertUpload(
    asset: AssetRecord,
    session: AssetUploadSessionRecord,
    transaction: TTransaction,
  ): Promise<void>;
  findUploadSessionForUpdate(
    workspaceId: string,
    uploadSessionId: string,
    transaction: TTransaction,
  ): Promise<AssetUploadAggregate | undefined>;
  completeUpload(
    workspaceId: string,
    uploadSessionId: string,
    input: CompleteAssetUploadInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  failUpload(
    workspaceId: string,
    uploadSessionId: string,
    input: FailAssetUploadInput,
    transaction: TTransaction,
  ): Promise<boolean>;
}
