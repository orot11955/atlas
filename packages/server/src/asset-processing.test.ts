import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import {
  ActorType,
  ASSET_IMAGE_VARIANT_SPECS,
  AssetKind,
  AssetProcessingAttemptStatus,
  AssetProcessingService,
  AssetStatus,
  AuditService,
  FixedClock,
  PassthroughTransactionRunner,
  assetVariantContentType,
  createUuidV7,
  requestContext,
  type AssetImageProcessorPort,
  type AssetProcessingAttemptRecord,
  type AssetProcessingObjectStoragePort,
  type AssetProcessingRepositoryPort,
  type AssetRecord,
  type AssetVariantRecord,
  type AuditRecord,
  type AuditRepositoryPort,
  type ClaimAssetProcessingInput,
  type ClaimAssetProcessingResult,
  type CompleteAssetProcessingInput,
  type FailAssetProcessingInput,
  type ProcessAssetImageInput,
  type ProcessedAssetImage,
} from './index';

test('Asset processing verifies the private original and publishes the complete Variant set', async () => {
  const clock = new FixedClock('2026-08-31T00:00:00.000Z');
  const workspaceId = createUuidV7(1);
  const assetId = createUuidV7(2);
  const original = Buffer.from('atlas-private-original');
  const asset = createUploadedAsset(workspaceId, assetId, original);
  const repository = new FakeProcessingRepository(asset);
  const storage = new FakeProcessingStorage(asset.originalObjectKey, original);
  const auditRepository = new InMemoryAuditRepository();
  const service = new AssetProcessingService(
    new PassthroughTransactionRunner(),
    repository,
    storage,
    new FakeImageProcessor(),
    new AuditService(auditRepository, clock),
    processingOptions(),
    clock,
  );

  const result = await requestContext.run(
    {
      requestId: createUuidV7(3),
      traceId: createUuidV7(4),
      correlationId: 'media-processing-test',
      actorType: ActorType.SYSTEM,
      actorId: 'worker:atlas-media',
      workspaceId,
    },
    () =>
      service.process({
        workspaceId,
        assetId,
        jobId: `${assetId}-2`,
        finalAttempt: false,
      }),
  );

  assert.equal(result.kind, 'ready');
  assert.equal(repository.completed?.variants.length, ASSET_IMAGE_VARIANT_SPECS.length);
  assert.equal(repository.failed, undefined);
  assert.equal(storage.publicObjects.size, ASSET_IMAGE_VARIANT_SPECS.length);
  assert.equal(storage.processingObjects.size, 0);
  assert.deepEqual(
    auditRepository.records.map((record) => record.action),
    ['asset.processing-completed'],
  );
});

test('Asset processing records retryable failure without exposing Object keys to Audit metadata', async () => {
  const clock = new FixedClock('2026-08-31T00:00:00.000Z');
  const workspaceId = createUuidV7(10);
  const assetId = createUuidV7(11);
  const original = Buffer.from('atlas-private-original');
  const asset = createUploadedAsset(workspaceId, assetId, original);
  const repository = new FakeProcessingRepository(asset);
  const storage = new FakeProcessingStorage(asset.originalObjectKey, original);
  const auditRepository = new InMemoryAuditRepository();
  const service = new AssetProcessingService(
    new PassthroughTransactionRunner(),
    repository,
    storage,
    {
      process: async () => {
        throw new Error('decoder unavailable');
      },
    },
    new AuditService(auditRepository, clock),
    processingOptions(),
    clock,
  );

  await assert.rejects(
    requestContext.run(
      {
        requestId: createUuidV7(12),
        traceId: createUuidV7(13),
        actorType: ActorType.SYSTEM,
        actorId: 'worker:atlas-media',
        workspaceId,
      },
      () =>
        service.process({
          workspaceId,
          assetId,
          jobId: `${assetId}-2`,
          finalAttempt: false,
        }),
    ),
  );

  assert.equal(repository.failed?.finalAttempt, false);
  assert.equal(repository.failed?.failureCode, 'asset_processing_failed');
  assert.equal(auditRepository.records.at(-1)?.action, 'asset.processing-failed');
  assert.equal(JSON.stringify(auditRepository.records).includes('originalObjectKey'), false);
  assert.equal(JSON.stringify(auditRepository.records).includes('objectKey'), false);
});

class FakeImageProcessor implements AssetImageProcessorPort {
  public async process(input: Readonly<ProcessAssetImageInput>): Promise<ProcessedAssetImage> {
    assert.equal(input.body.toString(), 'atlas-private-original');

    return {
      width: 1600,
      height: 1200,
      variants: input.variants.map((specification) => {
        const width = Math.min(specification.maximumWidth, 1600);

        return {
          key: specification.key,
          format: specification.format,
          contentType: assetVariantContentType(specification.format),
          width,
          height: Math.round(width * 0.75),
          body: Buffer.from(`variant:${specification.key}`),
        };
      }),
    };
  }
}

class FakeProcessingStorage implements AssetProcessingObjectStoragePort {
  public readonly processingObjects = new Map<string, Buffer>();
  public readonly publicObjects = new Map<string, Buffer>();

  public constructor(
    private readonly originalObjectKey: string,
    private readonly original: Buffer,
  ) {}

  public async bucketExists(): Promise<boolean> {
    return true;
  }

  public async getObjectStream(_bucket: string, objectKey: string): Promise<Readable> {
    assert.equal(objectKey, this.originalObjectKey);
    return Readable.from([this.original]);
  }

  public async putBuffer(bucket: string, objectKey: string, body: Buffer): Promise<void> {
    assert.equal(bucket, 'atlas-processing');
    this.processingObjects.set(objectKey, Buffer.from(body));
  }

  public async copyObject(
    sourceBucket: string,
    sourceObjectKey: string,
    destinationBucket: string,
    destinationObjectKey: string,
  ): Promise<void> {
    assert.equal(sourceBucket, 'atlas-processing');
    assert.equal(destinationBucket, 'atlas-public');
    const body = this.processingObjects.get(sourceObjectKey);
    assert.ok(body);
    this.publicObjects.set(destinationObjectKey, Buffer.from(body));
  }

  public async statObject(_bucket: string, objectKey: string) {
    const body = this.publicObjects.get(objectKey);
    assert.ok(body);

    return {
      size: body.length,
      etag: createHash('md5').update(body).digest('hex'),
    };
  }

  public async removeObject(bucket: string, objectKey: string): Promise<void> {
    if (bucket === 'atlas-processing') this.processingObjects.delete(objectKey);
    if (bucket === 'atlas-public') this.publicObjects.delete(objectKey);
  }
}

class FakeProcessingRepository implements AssetProcessingRepositoryPort<void> {
  public completed?: CompleteAssetProcessingInput;
  public failed?: FailAssetProcessingInput;

  public constructor(private readonly asset: AssetRecord) {}

  public async findVariants(): Promise<readonly AssetVariantRecord[]> {
    return this.completed?.variants ?? [];
  }

  public async claim(
    workspaceId: string,
    assetId: string,
    input: ClaimAssetProcessingInput,
  ): Promise<ClaimAssetProcessingResult> {
    assert.equal(workspaceId, this.asset.workspaceId);
    assert.equal(assetId, this.asset.id);
    const attempt: AssetProcessingAttemptRecord = {
      id: input.attemptId,
      workspaceId,
      assetId,
      jobId: input.jobId,
      attemptNumber: 1,
      status: AssetProcessingAttemptStatus.PROCESSING,
      startedAt: input.startedAt,
      createdAt: input.startedAt,
      updatedAt: input.startedAt,
    };

    return {
      kind: 'claimed',
      asset: { ...this.asset, status: AssetStatus.PROCESSING, version: this.asset.version + 1 },
      attempt,
    };
  }

  public async complete(
    _workspaceId: string,
    _assetId: string,
    input: CompleteAssetProcessingInput,
  ): Promise<boolean> {
    this.completed = input;
    return true;
  }

  public async fail(
    _workspaceId: string,
    _assetId: string,
    input: FailAssetProcessingInput,
  ): Promise<boolean> {
    this.failed = input;
    return true;
  }
}

class InMemoryAuditRepository implements AuditRepositoryPort<void> {
  public readonly records: AuditRecord[] = [];

  public async insert(record: AuditRecord): Promise<void> {
    this.records.push(record);
  }
}

function createUploadedAsset(workspaceId: string, id: string, original: Buffer): AssetRecord {
  const now = new Date('2026-08-31T00:00:00.000Z');

  return {
    id,
    workspaceId,
    kind: AssetKind.IMAGE,
    status: AssetStatus.UPLOADED,
    originalFileName: 'atlas.png',
    declaredContentType: 'image/png',
    detectedContentType: 'image/png',
    expectedSize: original.length,
    actualSize: original.length,
    sha256: createHash('sha256').update(original).digest('hex'),
    originalObjectKey: `assets/${workspaceId}/${id}/original`,
    originalEtag: 'original-etag',
    version: 2,
    createdByAdminAccountId: createUuidV7(30),
    uploadedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function processingOptions() {
  return {
    privateBucket: 'atlas-private',
    processingBucket: 'atlas-processing',
    publicBucket: 'atlas-public',
    maximumInputBytes: 1024,
    maximumOutputBytes: 1024,
    maximumPixels: 10_000_000,
    maximumDimension: 10_000,
    staleSeconds: 300,
  } as const;
}
