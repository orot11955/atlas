import { createAdminApiClient } from '../../lib/api';
import type {
  ApiEnvelope,
  Asset,
  AssetContentType,
  AssetUploadSessionResult,
  AssetUsageResult,
  AssetVariant,
} from './asset-types';

function client() {
  return createAdminApiClient();
}

export async function loadAssets(): Promise<readonly Asset[]> {
  const response = await client().get<ApiEnvelope<{ items: readonly Asset[] }>>('/assets');
  return response.data.items;
}

export async function loadAssetVariants(assetId: string): Promise<readonly AssetVariant[]> {
  const response = await client().get<ApiEnvelope<{ items: readonly AssetVariant[] }>>(
    `/assets/${encodeURIComponent(assetId)}/variants`,
  );
  return response.data.items;
}

export async function loadAssetUsages(assetId: string): Promise<AssetUsageResult> {
  const response = await client().get<ApiEnvelope<AssetUsageResult>>(
    `/assets/${encodeURIComponent(assetId)}/usages`,
  );
  return response.data;
}

export async function archiveAsset(assetId: string, version: number): Promise<Asset> {
  const response = await client().post<ApiEnvelope<Asset>>(
    `/assets/${encodeURIComponent(assetId)}/archive`,
    { version },
  );
  return response.data;
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
