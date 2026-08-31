import { requestContext } from '../../../core';
import { AssetStatus, type AssetRecord } from '../domain/asset';
import type {
  AssetProcessingQueuePort,
  EnqueueAssetProcessingInput,
} from '../ports/asset-processing.queue';

export interface AssetUploadCompletionPort {
  completeUpload(workspaceId: string, uploadSessionId: string): Promise<Readonly<AssetRecord>>;
}

export class AssetUploadCoordinator {
  public constructor(
    private readonly assetService: AssetUploadCompletionPort,
    private readonly processingQueue: AssetProcessingQueuePort,
  ) {}

  public async completeUpload(
    workspaceId: string,
    uploadSessionId: string,
  ): Promise<Readonly<AssetRecord>> {
    const asset = await this.assetService.completeUpload(workspaceId, uploadSessionId);

    if (asset.status === AssetStatus.UPLOADED) {
      await this.processingQueue.enqueue(createProcessingInput(asset));
    }

    return asset;
  }
}

function createProcessingInput(asset: Readonly<AssetRecord>): EnqueueAssetProcessingInput {
  const context = requestContext.get();
  const correlationId = context?.correlationId ?? context?.traceId;

  return {
    workspaceId: asset.workspaceId,
    assetId: asset.id,
    assetVersion: asset.version,
    ...(correlationId ? { correlationId } : {}),
  };
}
