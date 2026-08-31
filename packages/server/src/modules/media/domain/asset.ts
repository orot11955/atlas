import { DomainError, ErrorCode } from '../../../core';

export const AssetKind = {
  IMAGE: 'image',
} as const;

export type AssetKind = (typeof AssetKind)[keyof typeof AssetKind];

export const AssetStatus = {
  FAILED: 'failed',
  UPLOADED: 'uploaded',
  UPLOADING: 'uploading',
} as const;

export type AssetStatus = (typeof AssetStatus)[keyof typeof AssetStatus];

export const AssetUploadSessionStatus = {
  COMPLETED: 'completed',
  FAILED: 'failed',
  PENDING: 'pending',
} as const;

export type AssetUploadSessionStatus =
  (typeof AssetUploadSessionStatus)[keyof typeof AssetUploadSessionStatus];

export const ASSET_IMAGE_CONTENT_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
] as const);

export type AssetImageContentType = (typeof ASSET_IMAGE_CONTENT_TYPES)[number];

export interface AssetRecord {
  id: string;
  workspaceId: string;
  kind: AssetKind;
  status: AssetStatus;
  originalFileName: string;
  declaredContentType: AssetImageContentType;
  detectedContentType?: AssetImageContentType;
  expectedSize: number;
  actualSize?: number;
  sha256: string;
  originalObjectKey: string;
  originalEtag?: string;
  version: number;
  createdByAdminAccountId: string;
  uploadedAt?: Date;
  failedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssetUploadSessionRecord {
  id: string;
  workspaceId: string;
  assetId: string;
  status: AssetUploadSessionStatus;
  temporaryObjectKey: string;
  expectedSize: number;
  expectedSha256: string;
  declaredContentType: AssetImageContentType;
  expiresAt: Date;
  completedAt?: Date;
  failedAt?: Date;
  failureCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssetUploadAggregate {
  asset: AssetRecord;
  session: AssetUploadSessionRecord;
}

export function normalizeAssetFileName(value: string): string {
  const normalized = value.normalize('NFC').split(/[\\/]/u).at(-1)?.trim().replace(/\s+/gu, ' ');

  if (!normalized || normalized.length > 255 || containsControlCharacter(normalized)) {
    throw validationError('fileName', 'Asset file name is invalid.');
  }

  return normalized;
}

export function normalizeAssetContentType(value: string): AssetImageContentType {
  const normalized = value.trim().toLowerCase();

  if (!ASSET_IMAGE_CONTENT_TYPES.includes(normalized as AssetImageContentType)) {
    throw validationError('contentType', 'Only JPEG, PNG and WebP image uploads are supported.');
  }

  return normalized as AssetImageContentType;
}

export function normalizeAssetExpectedSize(value: number, maximumBytes: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    value > maximumBytes
  ) {
    throw validationError('size', `Asset size must contain between 1 and ${maximumBytes} bytes.`);
  }

  return value;
}

export function normalizeAssetSha256(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    throw validationError('sha256', 'Asset SHA-256 digest is invalid.');
  }

  return normalized;
}

export function detectAssetImageContentType(prefix: Buffer): AssetImageContentType | undefined {
  if (prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    prefix.length >= 8 &&
    prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }

  if (
    prefix.length >= 12 &&
    prefix.subarray(0, 4).toString('ascii') === 'RIFF' &&
    prefix.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  return undefined;
}

export function assertPendingAssetUpload(aggregate: AssetUploadAggregate, now: Date): void {
  if (
    aggregate.asset.status === AssetStatus.UPLOADED &&
    aggregate.session.status === AssetUploadSessionStatus.COMPLETED
  ) {
    return;
  }

  if (
    aggregate.asset.status !== AssetStatus.UPLOADING ||
    aggregate.session.status !== AssetUploadSessionStatus.PENDING
  ) {
    throw new DomainError({
      code: ErrorCode.INVALID_STATE_TRANSITION,
      message: 'Asset Upload Session is not pending.',
    });
  }

  if (aggregate.session.expiresAt.getTime() <= now.getTime()) {
    throw new DomainError({
      code: ErrorCode.INVALID_STATE_TRANSITION,
      message: 'Asset Upload Session has expired.',
    });
  }
}

export function createAssetTemporaryObjectKey(
  workspaceId: string,
  uploadSessionId: string,
): string {
  return `uploads/${workspaceId}/${uploadSessionId}`;
}

export function createAssetOriginalObjectKey(workspaceId: string, assetId: string): string {
  return `assets/${workspaceId}/${assetId}/original`;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }

  return false;
}

function validationError(field: string, message: string): DomainError {
  return new DomainError({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { field },
  });
}
