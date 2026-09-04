export type AssetStatus = 'uploading' | 'uploaded' | 'processing' | 'ready' | 'failed';
export type AssetContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface Asset {
  id: string;
  kind: 'image';
  status: AssetStatus;
  originalFileName: string;
  declaredContentType: AssetContentType;
  detectedContentType: AssetContentType | null;
  expectedSize: number;
  actualSize: number | null;
  sha256: string;
  width: number | null;
  height: number | null;
  processingFailureCode: string | null;
  version: number;
  uploadedAt: string | null;
  processedAt: string | null;
  failedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetUsage {
  id: string;
  contentId: string;
  revisionId: string;
  revisionNumber: number;
  contentTitle: string;
  kind: 'inline' | 'cover';
  ordinal: number;
  altText: string;
  caption: string | null;
  activePublicationCount: number;
  createdAt: string;
}

export interface AssetUsageResult {
  asset: Asset;
  items: readonly AssetUsage[];
}

export type AssetVariantKey = 'webp-320' | 'webp-768' | 'webp-1280' | 'avif-1920';
export type AssetVariantFormat = 'webp' | 'avif';

export interface AssetVariant {
  key: AssetVariantKey;
  format: AssetVariantFormat;
  contentType: 'image/webp' | 'image/avif';
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
  etag: string;
  publicUrl: string;
}

export interface AssetUploadSession {
  id: string;
  assetId: string;
  status: 'pending' | 'completed' | 'failed';
  expectedSize: number;
  expectedSha256: string;
  declaredContentType: AssetContentType;
  expiresAt: string;
  completedAt: string | null;
  failedAt: string | null;
}

export interface AssetUploadTarget {
  method: 'PUT';
  url: string;
  expiresAt: string;
  headers: Readonly<Record<string, string>>;
}

export interface AssetUploadSessionResult {
  asset: Asset;
  uploadSession: AssetUploadSession;
  upload: AssetUploadTarget;
}

export interface ApiEnvelope<T> {
  data: T;
}
