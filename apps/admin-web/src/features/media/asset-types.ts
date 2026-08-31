export type AssetStatus = 'uploading' | 'uploaded' | 'failed';
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
  version: number;
  uploadedAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
