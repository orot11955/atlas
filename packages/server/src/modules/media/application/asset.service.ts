import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import type { AuditService, Clock, TransactionRunner } from '../../../core';
import {
  ActorType,
  AuditResult,
  DomainError,
  ErrorCode,
  createUuidV7,
  requestContext,
  systemClock,
} from '../../../core';
import {
  AssetKind,
  AssetStatus,
  AssetUploadSessionStatus,
  assertPendingAssetUpload,
  createAssetOriginalObjectKey,
  createAssetTemporaryObjectKey,
  detectAssetImageContentType,
  normalizeAssetContentType,
  normalizeAssetExpectedSize,
  normalizeAssetFileName,
  normalizeAssetSha256,
  type AssetImageContentType,
  type AssetRecord,
  type AssetUploadSessionRecord,
} from '../domain/asset';
import type { AssetRepositoryPort } from '../ports/asset.repository';

export interface AssetObjectMetadata {
  size: number;
  etag: string;
  lastModified: Date;
  metadata: Record<string, string>;
}

export interface AssetObjectStoragePort {
  bucketExists(bucket: string): Promise<boolean>;
  statObject(bucket: string, objectKey: string): Promise<AssetObjectMetadata>;
  createPresignedPutUrl(
    bucket: string,
    objectKey: string,
    expiresInSeconds: number,
  ): Promise<string>;
  getObjectStream(bucket: string, objectKey: string): Promise<Readable>;
  copyObject(
    sourceBucket: string,
    sourceObjectKey: string,
    destinationBucket: string,
    destinationObjectKey: string,
  ): Promise<void>;
  removeObject(bucket: string, objectKey: string): Promise<void>;
}

export interface AssetServiceOptions {
  privateBucket: string;
  uploadTtlSeconds: number;
  maximumUploadBytes: number;
}

export interface CreateAssetUploadSessionInput {
  fileName: string;
  contentType: string;
  size: number;
  sha256: string;
}

export type AssetUploadSessionView = Omit<AssetUploadSessionRecord, 'temporaryObjectKey'>;

export interface CreateAssetUploadSessionResult {
  asset: Readonly<AssetRecord>;
  session: Readonly<AssetUploadSessionView>;
  upload: Readonly<{
    method: 'PUT';
    url: string;
    expiresAt: Date;
    headers: Readonly<Record<string, string>>;
  }>;
}

export class AssetService<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: AssetRepositoryPort<TTransaction>,
    private readonly objectStorage: AssetObjectStoragePort,
    private readonly auditService: AuditService<TTransaction>,
    private readonly options: Readonly<AssetServiceOptions>,
    private readonly clock: Clock = systemClock,
  ) {
    assertServiceOptions(options);
  }

  public async listAssets(
    workspaceId: string,
    limit = 100,
  ): Promise<readonly Readonly<AssetRecord>[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw validationError('limit', 'Asset list limit must be between 1 and 100.');
    }

    const records = await this.repository.list(workspaceId, limit);
    return Object.freeze(records.map(freezeAsset));
  }

  public async getAsset(workspaceId: string, assetId: string): Promise<Readonly<AssetRecord>> {
    const asset = await this.repository.findById(workspaceId, assetId);

    if (!asset) {
      throw assetNotFoundError();
    }

    return freezeAsset(asset);
  }

  public async createUploadSession(
    workspaceId: string,
    input: CreateAssetUploadSessionInput,
  ): Promise<Readonly<CreateAssetUploadSessionResult>> {
    const actorId = requireAdminActorId();
    const now = this.clock.now();
    const assetId = createUuidV7(now.getTime());
    const uploadSessionId = createUuidV7(now.getTime());
    const fileName = normalizeAssetFileName(input.fileName);
    const contentType = normalizeAssetContentType(input.contentType);
    const size = normalizeAssetExpectedSize(input.size, this.options.maximumUploadBytes);
    const sha256 = normalizeAssetSha256(input.sha256);
    const expiresAt = new Date(now.getTime() + this.options.uploadTtlSeconds * 1_000);
    const temporaryObjectKey = createAssetTemporaryObjectKey(workspaceId, uploadSessionId);
    const originalObjectKey = createAssetOriginalObjectKey(workspaceId, assetId);

    if (!(await this.objectStorage.bucketExists(this.options.privateBucket))) {
      throw new DomainError({
        code: ErrorCode.ACTION_NOT_ALLOWED,
        message: 'Private Asset storage is not ready.',
      });
    }

    const uploadUrl = await this.objectStorage.createPresignedPutUrl(
      this.options.privateBucket,
      temporaryObjectKey,
      this.options.uploadTtlSeconds,
    );
    const asset: AssetRecord = {
      id: assetId,
      workspaceId,
      kind: AssetKind.IMAGE,
      status: AssetStatus.UPLOADING,
      originalFileName: fileName,
      declaredContentType: contentType,
      expectedSize: size,
      sha256,
      originalObjectKey,
      version: 1,
      createdByAdminAccountId: actorId,
      createdAt: now,
      updatedAt: now,
    };
    const session: AssetUploadSessionRecord = {
      id: uploadSessionId,
      workspaceId,
      assetId,
      status: AssetUploadSessionStatus.PENDING,
      temporaryObjectKey,
      expectedSize: size,
      expectedSha256: sha256,
      declaredContentType: contentType,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };

    await this.transactionRunner.run(async (transaction) => {
      await this.repository.insertUpload(asset, session, transaction);
      await this.auditService.record(
        {
          action: 'asset.upload-session-created',
          targetType: 'asset',
          targetId: assetId,
          result: AuditResult.SUCCESS,
          metadata: {
            uploadSessionId,
            kind: AssetKind.IMAGE,
            contentType,
            size,
            expiresAt: expiresAt.toISOString(),
          },
        },
        transaction,
      );
    });

    return Object.freeze({
      asset: freezeAsset(asset),
      session: freezeUploadSession(session),
      upload: Object.freeze({
        method: 'PUT' as const,
        url: uploadUrl,
        expiresAt: new Date(expiresAt),
        headers: Object.freeze({ 'Content-Type': contentType }),
      }),
    });
  }

  public async completeUpload(
    workspaceId: string,
    uploadSessionId: string,
  ): Promise<Readonly<AssetRecord>> {
    const completedAt = this.clock.now();
    const outcome = await this.transactionRunner.run(async (transaction) => {
      const aggregate = await this.repository.findUploadSessionForUpdate(
        workspaceId,
        uploadSessionId,
        transaction,
      );

      if (!aggregate) {
        throw uploadSessionNotFoundError();
      }

      if (
        aggregate.asset.status === AssetStatus.UPLOADED &&
        aggregate.session.status === AssetUploadSessionStatus.COMPLETED
      ) {
        return { asset: freezeAsset(aggregate.asset) } as const;
      }

      try {
        assertPendingAssetUpload(aggregate, completedAt);
      } catch (error) {
        return this.failWithinTransaction(
          aggregate,
          'upload_session_not_pending',
          completedAt,
          transaction,
          error,
        );
      }

      let verification: VerifiedUpload;

      try {
        verification = await this.verifyUploadedObject(aggregate.session);
      } catch (error) {
        return this.failWithinTransaction(
          aggregate,
          readFailureCode(error),
          completedAt,
          transaction,
          error,
        );
      }

      try {
        await this.objectStorage.copyObject(
          this.options.privateBucket,
          aggregate.session.temporaryObjectKey,
          this.options.privateBucket,
          aggregate.asset.originalObjectKey,
        );
        const completed = await this.repository.completeUpload(
          workspaceId,
          uploadSessionId,
          {
            actualSize: verification.size,
            detectedContentType: verification.contentType,
            originalEtag: verification.etag,
            completedAt,
          },
          transaction,
        );

        if (!completed) {
          throw new DomainError({
            code: ErrorCode.VERSION_CONFLICT,
            message: 'Asset Upload Session was changed by another request.',
          });
        }

        await this.auditService.record(
          {
            action: 'asset.upload-completed',
            targetType: 'asset',
            targetId: aggregate.asset.id,
            result: AuditResult.SUCCESS,
            metadata: {
              uploadSessionId,
              contentType: verification.contentType,
              size: verification.size,
              etag: verification.etag,
            },
          },
          transaction,
        );
        await safeRemove(
          this.objectStorage,
          this.options.privateBucket,
          aggregate.session.temporaryObjectKey,
        );

        return {
          asset: freezeAsset({
            ...aggregate.asset,
            status: AssetStatus.UPLOADED,
            detectedContentType: verification.contentType,
            actualSize: verification.size,
            originalEtag: verification.etag,
            version: aggregate.asset.version + 1,
            uploadedAt: completedAt,
            updatedAt: completedAt,
          }),
        } as const;
      } catch (error) {
        await safeRemove(
          this.objectStorage,
          this.options.privateBucket,
          aggregate.asset.originalObjectKey,
        );
        throw error;
      }
    });

    if ('error' in outcome) {
      throw outcome.error;
    }

    return outcome.asset;
  }

  private async verifyUploadedObject(session: AssetUploadSessionRecord): Promise<VerifiedUpload> {
    let metadata: AssetObjectMetadata;

    try {
      metadata = await this.objectStorage.statObject(
        this.options.privateBucket,
        session.temporaryObjectKey,
      );
    } catch (cause) {
      throw validationFailure(
        'asset_object_missing',
        'Uploaded Asset Object was not found.',
        cause,
      );
    }

    if (metadata.size !== session.expectedSize) {
      throw validationFailure(
        'asset_size_mismatch',
        'Uploaded Asset size does not match the declared size.',
      );
    }

    const metadataContentType = readMetadataContentType(metadata.metadata);

    if (metadataContentType && metadataContentType !== session.declaredContentType) {
      throw validationFailure(
        'asset_content_type_mismatch',
        'Uploaded Asset Content-Type does not match the declared Content-Type.',
      );
    }

    const stream = await this.objectStorage.getObjectStream(
      this.options.privateBucket,
      session.temporaryObjectKey,
    );
    const inspected = await inspectObjectStream(stream, this.options.maximumUploadBytes);

    if (inspected.size !== session.expectedSize) {
      throw validationFailure(
        'asset_stream_size_mismatch',
        'Uploaded Asset size changed during verification.',
      );
    }

    if (inspected.sha256 !== session.expectedSha256) {
      throw validationFailure(
        'asset_sha256_mismatch',
        'Uploaded Asset SHA-256 does not match the declared digest.',
      );
    }

    const detected = detectAssetImageContentType(inspected.prefix);

    if (!detected || detected !== session.declaredContentType) {
      throw validationFailure(
        'asset_magic_byte_mismatch',
        'Uploaded Asset bytes do not match the declared image format.',
      );
    }

    return {
      size: inspected.size,
      sha256: inspected.sha256,
      contentType: detected,
      etag: normalizeEtag(metadata.etag),
    };
  }

  private async failWithinTransaction(
    aggregate: { asset: AssetRecord; session: AssetUploadSessionRecord },
    failureCode: string,
    failedAt: Date,
    transaction: TTransaction,
    cause: unknown,
  ): Promise<Readonly<{ error: DomainError }>> {
    await safeRemove(
      this.objectStorage,
      this.options.privateBucket,
      aggregate.session.temporaryObjectKey,
    );
    await this.repository.failUpload(
      aggregate.asset.workspaceId,
      aggregate.session.id,
      { failureCode, failedAt },
      transaction,
    );
    await this.auditService.record(
      {
        action: 'asset.upload-failed',
        targetType: 'asset',
        targetId: aggregate.asset.id,
        result: AuditResult.FAILURE,
        metadata: {
          uploadSessionId: aggregate.session.id,
          failureCode,
        },
      },
      transaction,
    );

    return Object.freeze({
      error:
        cause instanceof DomainError
          ? cause
          : new DomainError({
              code: ErrorCode.VALIDATION_FAILED,
              message: 'Uploaded Asset failed server verification.',
              details: { failureCode },
              cause,
            }),
    });
  }
}

interface VerifiedUpload {
  size: number;
  sha256: string;
  contentType: AssetImageContentType;
  etag: string;
}

async function inspectObjectStream(
  stream: Readable,
  maximumBytes: number,
): Promise<{ size: number; sha256: string; prefix: Buffer }> {
  const hash = createHash('sha256');
  let size = 0;
  let prefix = Buffer.alloc(0);

  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    size += chunk.length;

    if (size > maximumBytes) {
      throw validationFailure(
        'asset_size_limit_exceeded',
        'Uploaded Asset exceeds the size limit.',
      );
    }

    hash.update(chunk);

    if (prefix.length < 32) {
      prefix = Buffer.concat([prefix, chunk.subarray(0, 32 - prefix.length)]);
    }
  }

  return { size, sha256: hash.digest('hex'), prefix };
}

function readMetadataContentType(metadata: Record<string, string>): string | undefined {
  const value = Object.entries(metadata).find(([key]) => key.toLowerCase() === 'content-type')?.[1];
  return value?.split(';', 1)[0]?.trim().toLowerCase();
}

function normalizeEtag(value: string): string {
  const normalized = value.trim().replace(/^"|"$/gu, '');

  if (!normalized || normalized.length > 128) {
    throw validationFailure('asset_etag_invalid', 'Uploaded Asset ETag is invalid.');
  }

  return normalized;
}

function validationFailure(code: string, message: string, cause?: unknown): DomainError {
  return new DomainError({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { failureCode: code },
    cause,
  });
}

function readFailureCode(error: unknown): string {
  if (error instanceof DomainError) {
    const value = error.details?.failureCode;
    if (typeof value === 'string') return value;
  }
  return 'asset_verification_failed';
}

function requireAdminActorId(): string {
  const context = requestContext.require();

  if (context.actorType !== ActorType.ADMIN || !context.actorId) {
    throw new DomainError({
      code: ErrorCode.AUTH_REQUIRED,
      message: 'An authenticated administrator is required.',
    });
  }

  return context.actorId;
}

function assertServiceOptions(options: Readonly<AssetServiceOptions>): void {
  if (!options.privateBucket.trim()) {
    throw new TypeError('Asset private bucket is required.');
  }
  if (
    !Number.isSafeInteger(options.uploadTtlSeconds) ||
    options.uploadTtlSeconds < 60 ||
    options.uploadTtlSeconds > 3_600
  ) {
    throw new TypeError('Asset upload TTL must be between 60 and 3600 seconds.');
  }
  if (!Number.isSafeInteger(options.maximumUploadBytes) || options.maximumUploadBytes < 1) {
    throw new TypeError('Asset maximum upload size must be a positive safe integer.');
  }
}

function freezeAsset(asset: AssetRecord): Readonly<AssetRecord> {
  return Object.freeze({
    ...asset,
    uploadedAt: asset.uploadedAt ? new Date(asset.uploadedAt) : undefined,
    failedAt: asset.failedAt ? new Date(asset.failedAt) : undefined,
    createdAt: new Date(asset.createdAt),
    updatedAt: new Date(asset.updatedAt),
  });
}

function freezeUploadSession(session: AssetUploadSessionRecord): Readonly<AssetUploadSessionView> {
  return Object.freeze({
    id: session.id,
    workspaceId: session.workspaceId,
    assetId: session.assetId,
    status: session.status,
    expectedSize: session.expectedSize,
    expectedSha256: session.expectedSha256,
    declaredContentType: session.declaredContentType,
    expiresAt: new Date(session.expiresAt),
    completedAt: session.completedAt ? new Date(session.completedAt) : undefined,
    failedAt: session.failedAt ? new Date(session.failedAt) : undefined,
    failureCode: session.failureCode,
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt),
  });
}

async function safeRemove(
  storage: AssetObjectStoragePort,
  bucket: string,
  objectKey: string,
): Promise<void> {
  try {
    await storage.removeObject(bucket, objectKey);
  } catch {
    // Orphan cleanup is handled by the periodic media maintenance job added in a later slice.
  }
}

function validationError(field: string, message: string): DomainError {
  return new DomainError({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { field },
  });
}

function assetNotFoundError(): DomainError {
  return new DomainError({ code: ErrorCode.NOT_FOUND, message: 'Asset was not found.' });
}

function uploadSessionNotFoundError(): DomainError {
  return new DomainError({
    code: ErrorCode.NOT_FOUND,
    message: 'Asset Upload Session was not found.',
  });
}
