export const AssetVariantFormat = {
  AVIF: 'avif',
  WEBP: 'webp',
} as const;

export type AssetVariantFormat = (typeof AssetVariantFormat)[keyof typeof AssetVariantFormat];

export const AssetVariantKey = {
  AVIF_1920: 'avif-1920',
  WEBP_1280: 'webp-1280',
  WEBP_320: 'webp-320',
  WEBP_768: 'webp-768',
} as const;

export type AssetVariantKey = (typeof AssetVariantKey)[keyof typeof AssetVariantKey];

export type AssetVariantContentType = 'image/avif' | 'image/webp';

export interface AssetImageVariantSpec {
  key: AssetVariantKey;
  format: AssetVariantFormat;
  maximumWidth: number;
  quality: number;
}

export const ASSET_IMAGE_VARIANT_SPECS: readonly Readonly<AssetImageVariantSpec>[] = Object.freeze([
  Object.freeze({
    key: AssetVariantKey.WEBP_320,
    format: AssetVariantFormat.WEBP,
    maximumWidth: 320,
    quality: 82,
  }),
  Object.freeze({
    key: AssetVariantKey.WEBP_768,
    format: AssetVariantFormat.WEBP,
    maximumWidth: 768,
    quality: 82,
  }),
  Object.freeze({
    key: AssetVariantKey.WEBP_1280,
    format: AssetVariantFormat.WEBP,
    maximumWidth: 1280,
    quality: 82,
  }),
  Object.freeze({
    key: AssetVariantKey.AVIF_1920,
    format: AssetVariantFormat.AVIF,
    maximumWidth: 1920,
    quality: 55,
  }),
]);

export const AssetProcessingAttemptStatus = {
  FAILED: 'failed',
  PROCESSING: 'processing',
  SUCCEEDED: 'succeeded',
} as const;

export type AssetProcessingAttemptStatus =
  (typeof AssetProcessingAttemptStatus)[keyof typeof AssetProcessingAttemptStatus];

export interface AssetVariantRecord {
  id: string;
  workspaceId: string;
  assetId: string;
  key: AssetVariantKey;
  format: AssetVariantFormat;
  contentType: AssetVariantContentType;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
  objectKey: string;
  etag: string;
  createdAt: Date;
}

export interface AssetProcessingAttemptRecord {
  id: string;
  workspaceId: string;
  assetId: string;
  jobId: string;
  attemptNumber: number;
  status: AssetProcessingAttemptStatus;
  startedAt: Date;
  completedAt?: Date;
  failedAt?: Date;
  failureCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

export function assetVariantContentType(format: AssetVariantFormat): AssetVariantContentType {
  return format === AssetVariantFormat.AVIF ? 'image/avif' : 'image/webp';
}

export function createAssetProcessingObjectKey(
  workspaceId: string,
  assetId: string,
  attemptId: string,
  key: AssetVariantKey,
  format: AssetVariantFormat,
): string {
  return `processing/${workspaceId}/${assetId}/${attemptId}/${key}.${format}`;
}

export function createAssetVariantObjectKey(
  workspaceId: string,
  assetId: string,
  key: AssetVariantKey,
  format: AssetVariantFormat,
): string {
  return `assets/${workspaceId}/${assetId}/variants/${key}.${format}`;
}

export function normalizeAssetProcessingFailureCode(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '_');

  return normalized.length > 0 && normalized.length <= 80 ? normalized : 'asset_processing_failed';
}
