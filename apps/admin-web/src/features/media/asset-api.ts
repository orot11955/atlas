import { createAdminApiClient } from '../../lib/api';
import type { ApiEnvelope, Asset, AssetContentType, AssetUploadSessionResult } from './asset-types';

function client() {
  return createAdminApiClient();
}

export async function loadAssets(): Promise<readonly Asset[]> {
  const response = await client().get<ApiEnvelope<{ items: readonly Asset[] }>>('/assets');
  return response.data.items;
}

export async function createAssetUploadSession(input: {
  fileName: string;
  contentType: AssetContentType;
  size: number;
  sha256: string;
}): Promise<AssetUploadSessionResult> {
  const response = await client().post<ApiEnvelope<AssetUploadSessionResult>>(
    '/assets/upload-sessions',
    input,
  );
  return response.data;
}

export async function completeAssetUpload(uploadSessionId: string): Promise<Asset> {
  const response = await client().post<ApiEnvelope<Asset>>(
    `/assets/upload-sessions/${encodeURIComponent(uploadSessionId)}/complete`,
  );
  return response.data;
}
