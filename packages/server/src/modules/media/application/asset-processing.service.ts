import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import type { AuditService, Clock, TransactionRunner } from '../../../core';
import { AuditResult, DomainError, ErrorCode, createUuidV7, systemClock } from '../../../core';
import type { AssetRecord } from '../domain/asset';
import {
  ASSET_IMAGE_VARIANT_SPECS,
  assetVariantContentType,
  createAssetProcessingObjectKey,
  createAssetVariantObjectKey,
  normalizeAssetProcessingFailureCode,
  type AssetVariantRecord,
} from '../domain/asset-processing';
import type {
  AssetImageProcessorPort,
  ProcessedAssetImage,
} from '../ports/asset-image-processor.port';
import type { AssetProcessingObjectStoragePort } from '../ports/asset-processing-object-storage.port';
import type {
  AssetProcessingRepositoryPort,
  ClaimAssetProcessingResult,
} from '../ports/asset-processing.repository';

export interface AssetProcessingServiceOptions {
  privateBucket: string;
  processingBucket: string;
  publicBucket: string;
  maximumInputBytes: number;
  maximumOutputBytes: number;
  maximumPixels: number;
  maximumDimension: number;
  staleSeconds: number;
}

export interface ProcessAssetInput {
  workspaceId: string;
  assetId: string;
  jobId: string;
  finalAttempt: boolean;
}

export type ProcessAssetResult =
  | Readonly<{ kind: 'already-ready'; assetId: string; variants: readonly AssetVariantRecord[] }>
  | Readonly<{ kind: 'busy'; assetId: string }>
  | Readonly<{ kind: 'ignored'; assetId: string; reason: 'missing' | 'not-processable' }>
  | Readonly<{
      kind: 'ready';
      assetId: string;
      attemptId: string;
      variants: readonly AssetVariantRecord[];
    }>;

export class AssetProcessingService<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: AssetProcessingRepositoryPort<TTransaction>,
    private readonly objectStorage: AssetProcessingObjectStoragePort,
    private readonly imageProcessor: AssetImageProcessorPort,
    private readonly auditService: AuditService<TTransaction>,
    private readonly options: Readonly<AssetProcessingServiceOptions>,
    private readonly clock: Clock = systemClock,
  ) {
    assertOptions(options);
  }

  public async process(input: Readonly<ProcessAssetInput>): Promise<Readonly<ProcessAssetResult>> {
    assertProcessInput(input);
    const startedAt = this.clock.now();
    const attemptId = createUuidV7(startedAt.getTime());
    const claim = await this.transactionRunner.run((transaction) =>
      this.repository.claim(
        input.workspaceId,
        input.assetId,
        {
          attemptId,
          jobId: input.jobId,
          startedAt,
          staleBefore: new Date(startedAt.getTime() - this.options.staleSeconds * 1_000),
        },
        transaction,
      ),
    );

    if (claim.kind === 'missing') {
      return Object.freeze({ kind: 'ignored', assetId: input.assetId, reason: 'missing' });
    }

    if (claim.kind === 'not-processable') {
      return Object.freeze({
        kind: 'ignored',
        assetId: input.assetId,
        reason: 'not-processable',
      });
    }

    if (claim.kind === 'busy') {
      return Object.freeze({ kind: 'busy', assetId: input.assetId });
    }

    if (claim.kind === 'already-ready') {
      return Object.freeze({
        kind: 'already-ready',
        assetId: input.assetId,
        variants: Object.freeze([...claim.variants]),
      });
    }

    return this.processClaimedAsset(input, claim);
  }

  private async processClaimedAsset(
    input: Readonly<ProcessAssetInput>,
    claim: Extract<ClaimAssetProcessingResult, { kind: 'claimed' }>,
  ): Promise<Readonly<ProcessAssetResult>> {
    const processingObjectKeys: string[] = [];
    const publicObjectKeys: string[] = [];

    try {
      await this.assertStorageReady();
      const original = await this.readAndVerifyOriginal(claim.asset);
      const processed = await this.imageProcessor.process({
        body: original,
        variants: ASSET_IMAGE_VARIANT_SPECS,
        limits: {
          maximumInputBytes: this.options.maximumInputBytes,
          maximumOutputBytes: this.options.maximumOutputBytes,
          maximumPixels: this.options.maximumPixels,
          maximumDimension: this.options.maximumDimension,
        },
      });
      assertProcessedImage(processed, this.options);
      const variants = await this.writeVariants(
        claim,
        processed,
        processingObjectKeys,
        publicObjectKeys,
      );
      const completedAt = this.clock.now();

      await this.transactionRunner.run(async (transaction) => {
        const completed = await this.repository.complete(
          input.workspaceId,
          input.assetId,
          {
            attemptId: claim.attempt.id,
            width: processed.width,
            height: processed.height,
            variants,
            completedAt,
          },
          transaction,
        );

        if (!completed) {
          throw new DomainError({
            code: ErrorCode.VERSION_CONFLICT,
            message: 'Asset processing state changed before completion.',
            details: { failureCode: 'asset_processing_state_conflict' },
          });
        }

        await this.auditService.record(
          {
            action: 'asset.processing-completed',
            targetType: 'asset',
            targetId: input.assetId,
            result: AuditResult.SUCCESS,
            metadata: {
              attemptId: claim.attempt.id,
              attemptNumber: claim.attempt.attemptNumber,
              width: processed.width,
              height: processed.height,
              variantKeys: variants.map((variant) => variant.key).join(','),
            },
          },
          transaction,
        );
      });

      await safeRemoveMany(this.objectStorage, this.options.processingBucket, processingObjectKeys);

      return Object.freeze({
        kind: 'ready',
        assetId: input.assetId,
        attemptId: claim.attempt.id,
        variants: Object.freeze([...variants]),
      });
    } catch (error) {
      await Promise.all([
        safeRemoveMany(this.objectStorage, this.options.processingBucket, processingObjectKeys),
        safeRemoveMany(this.objectStorage, this.options.publicBucket, publicObjectKeys),
      ]);

      const normalizedError = toProcessingError(error);
      const failureCode = readFailureCode(normalizedError);
      const failedAt = this.clock.now();

      await this.transactionRunner.run(async (transaction) => {
        const failed = await this.repository.fail(
          input.workspaceId,
          input.assetId,
          {
            attemptId: claim.attempt.id,
            failureCode,
            finalAttempt: input.finalAttempt,
            failedAt,
          },
          transaction,
        );

        if (failed) {
          await this.auditService.record(
            {
              action: 'asset.processing-failed',
              targetType: 'asset',
              targetId: input.assetId,
              result: AuditResult.FAILURE,
              errorCode: normalizedError.code,
              metadata: {
                attemptId: claim.attempt.id,
                attemptNumber: claim.attempt.attemptNumber,
                failureCode,
                finalAttempt: input.finalAttempt,
              },
            },
            transaction,
          );
        }
      });

      throw normalizedError;
    }
  }

  private async assertStorageReady(): Promise<void> {
    const buckets = [
      this.options.privateBucket,
      this.options.processingBucket,
      this.options.publicBucket,
    ];
    let available: boolean[];

    try {
      available = await Promise.all(
        buckets.map((bucket) => this.objectStorage.bucketExists(bucket)),
      );
    } catch (cause) {
      throw processingFailure(
        'asset_storage_unavailable',
        'Asset storage availability could not be verified.',
        cause,
      );
    }

    if (available.some((value) => !value)) {
      throw processingFailure('asset_storage_not_ready', 'Asset storage buckets are not ready.');
    }
  }

  private async readAndVerifyOriginal(asset: AssetRecord): Promise<Buffer> {
    let stream: Readable;

    try {
      stream = await this.objectStorage.getObjectStream(
        this.options.privateBucket,
        asset.originalObjectKey,
      );
    } catch (cause) {
      throw processingFailure(
        'asset_original_read_failed',
        'Private Asset original could not be read.',
        cause,
      );
    }

    const body = await readObjectStream(stream, this.options.maximumInputBytes);

    if (asset.actualSize === undefined || body.length !== asset.actualSize) {
      throw processingFailure(
        'asset_original_size_mismatch',
        'Private Asset original size changed after upload verification.',
      );
    }

    const sha256 = createHash('sha256').update(body).digest('hex');

    if (sha256 !== asset.sha256) {
      throw processingFailure(
        'asset_original_sha256_mismatch',
        'Private Asset original digest changed after upload verification.',
      );
    }

    return body;
  }

  private async writeVariants(
    claim: Extract<ClaimAssetProcessingResult, { kind: 'claimed' }>,
    processed: Readonly<ProcessedAssetImage>,
    processingObjectKeys: string[],
    publicObjectKeys: string[],
  ): Promise<readonly AssetVariantRecord[]> {
    const records: AssetVariantRecord[] = [];

    for (const variant of processed.variants) {
      const processingObjectKey = createAssetProcessingObjectKey(
        claim.asset.workspaceId,
        claim.asset.id,
        claim.attempt.id,
        variant.key,
        variant.format,
      );
      const publicObjectKey = createAssetVariantObjectKey(
        claim.asset.workspaceId,
        claim.asset.id,
        variant.key,
        variant.format,
      );
      processingObjectKeys.push(processingObjectKey);

      try {
        await this.objectStorage.putBuffer(
          this.options.processingBucket,
          processingObjectKey,
          variant.body,
          {
            'Content-Type': variant.contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        );
        publicObjectKeys.push(publicObjectKey);
        await this.objectStorage.copyObject(
          this.options.processingBucket,
          processingObjectKey,
          this.options.publicBucket,
          publicObjectKey,
        );
        const stored = await this.objectStorage.statObject(
          this.options.publicBucket,
          publicObjectKey,
        );

        if (stored.size !== variant.body.length) {
          throw processingFailure(
            'asset_variant_size_mismatch',
            'Stored Asset Variant size does not match the generated output.',
          );
        }

        records.push({
          id: createUuidV7(this.clock.now().getTime()),
          workspaceId: claim.asset.workspaceId,
          assetId: claim.asset.id,
          key: variant.key,
          format: variant.format,
          contentType: variant.contentType,
          width: variant.width,
          height: variant.height,
          byteSize: variant.body.length,
          sha256: createHash('sha256').update(variant.body).digest('hex'),
          objectKey: publicObjectKey,
          etag: normalizeEtag(stored.etag),
          createdAt: this.clock.now(),
        });
      } catch (cause) {
        if (cause instanceof DomainError) {
          throw cause;
        }

        throw processingFailure(
          'asset_variant_write_failed',
          'Generated Asset Variant could not be persisted.',
          cause,
        );
      }
    }

    return Object.freeze(records);
  }
}

async function readObjectStream(stream: Readable, maximumBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  try {
    for await (const value of stream) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
      size += chunk.length;

      if (size > maximumBytes) {
        throw processingFailure(
          'asset_original_size_limit_exceeded',
          'Private Asset original exceeds the processing size limit.',
        );
      }

      chunks.push(chunk);
    }
  } catch (cause) {
    if (cause instanceof DomainError) {
      throw cause;
    }

    throw processingFailure(
      'asset_original_stream_failed',
      'Private Asset original stream could not be consumed.',
      cause,
    );
  }

  if (size < 1) {
    throw processingFailure('asset_original_empty', 'Private Asset original is empty.');
  }

  return Buffer.concat(chunks, size);
}

function assertProcessedImage(
  processed: Readonly<ProcessedAssetImage>,
  options: Readonly<AssetProcessingServiceOptions>,
): void {
  assertDimension(processed.width, options.maximumDimension, 'width');
  assertDimension(processed.height, options.maximumDimension, 'height');

  if (processed.width * processed.height > options.maximumPixels) {
    throw processingFailure(
      'asset_pixel_limit_exceeded',
      'Decoded Asset image exceeds the pixel limit.',
    );
  }

  if (processed.variants.length !== ASSET_IMAGE_VARIANT_SPECS.length) {
    throw processingFailure(
      'asset_variant_set_incomplete',
      'Image processor did not produce the required Asset Variant set.',
    );
  }

  const specifications = new Map(ASSET_IMAGE_VARIANT_SPECS.map((spec) => [spec.key, spec]));
  const seen = new Set<string>();

  for (const variant of processed.variants) {
    const specification = specifications.get(variant.key);

    if (!specification || seen.has(variant.key)) {
      throw processingFailure(
        'asset_variant_set_invalid',
        'Image processor produced an unknown or duplicate Asset Variant.',
      );
    }

    seen.add(variant.key);

    if (
      variant.format !== specification.format ||
      variant.contentType !== assetVariantContentType(specification.format)
    ) {
      throw processingFailure(
        'asset_variant_format_mismatch',
        'Generated Asset Variant format does not match its specification.',
      );
    }

    assertDimension(variant.width, options.maximumDimension, 'variantWidth');
    assertDimension(variant.height, options.maximumDimension, 'variantHeight');

    if (variant.width > specification.maximumWidth) {
      throw processingFailure(
        'asset_variant_width_exceeded',
        'Generated Asset Variant exceeds its maximum width.',
      );
    }

    if (
      variant.width * variant.height > options.maximumPixels ||
      variant.body.length < 1 ||
      variant.body.length > options.maximumOutputBytes
    ) {
      throw processingFailure(
        'asset_variant_output_limit_exceeded',
        'Generated Asset Variant exceeds the output limit.',
      );
    }
  }
}

function assertDimension(value: number, maximum: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw processingFailure(
      'asset_dimension_limit_exceeded',
      `Decoded Asset ${field} is outside the allowed range.`,
    );
  }
}

function assertProcessInput(input: Readonly<ProcessAssetInput>): void {
  if (!input.workspaceId || !input.assetId || !input.jobId || input.jobId.length > 128) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Asset processing Job input is invalid.',
      details: { failureCode: 'asset_processing_job_invalid' },
    });
  }
}

function assertOptions(options: Readonly<AssetProcessingServiceOptions>): void {
  for (const [field, value] of Object.entries({
    maximumInputBytes: options.maximumInputBytes,
    maximumOutputBytes: options.maximumOutputBytes,
    maximumPixels: options.maximumPixels,
    maximumDimension: options.maximumDimension,
    staleSeconds: options.staleSeconds,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`Asset processing ${field} must be a positive safe integer.`);
    }
  }

  for (const bucket of [options.privateBucket, options.processingBucket, options.publicBucket]) {
    if (!bucket.trim()) {
      throw new TypeError('Asset processing Bucket names are required.');
    }
  }
}

function normalizeEtag(value: string): string {
  const normalized = value.trim().replace(/^"|"$/gu, '');

  if (!normalized || normalized.length > 128) {
    throw processingFailure('asset_variant_etag_invalid', 'Stored Asset Variant ETag is invalid.');
  }

  return normalized;
}

function processingFailure(code: string, message: string, cause?: unknown): DomainError {
  return new DomainError({
    code: ErrorCode.INTERNAL_ERROR,
    message,
    details: { failureCode: normalizeAssetProcessingFailureCode(code) },
    cause,
  });
}

function toProcessingError(error: unknown): DomainError {
  return error instanceof DomainError
    ? error
    : processingFailure('asset_processing_failed', 'Asset processing failed.', error);
}

function readFailureCode(error: DomainError): string {
  const value = error.details?.failureCode;

  return normalizeAssetProcessingFailureCode(
    typeof value === 'string' ? value : 'asset_processing_failed',
  );
}

async function safeRemoveMany(
  storage: AssetProcessingObjectStoragePort,
  bucket: string,
  objectKeys: readonly string[],
): Promise<void> {
  await Promise.all(
    objectKeys.map(async (objectKey) => {
      try {
        await storage.removeObject(bucket, objectKey);
      } catch {
        // A periodic Media cleanup job handles orphaned processing objects.
      }
    }),
  );
}
