export const MEDIA_PROCESS_JOB_NAME = 'media.process';

export interface AssetProcessingJobData {
  workspaceId: string;
  assetId: string;
  assetVersion: number;
  correlationId?: string;
}

export type EnqueueAssetProcessingInput = AssetProcessingJobData;

export interface AssetProcessingQueuePort {
  enqueue(input: Readonly<EnqueueAssetProcessingInput>): Promise<void>;
}
