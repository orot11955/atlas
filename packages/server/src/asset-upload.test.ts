import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import {
  ActorType,
  AssetService,
  AssetStatus,
  AssetUploadSessionStatus,
  AuditService,
  FixedClock,
  PassthroughTransactionRunner,
  createUuidV7,
  detectAssetImageContentType,
  normalizeAssetContentType,
  normalizeAssetFileName,
  requestContext,
  type AssetObjectStoragePort,
  type AssetRecord,
  type AssetRepositoryPort,
  type AssetUploadAggregate,
  type AssetUploadSessionRecord,
  type AuditRecord,
  type AuditRepositoryPort,
  type CompleteAssetUploadInput,
  type FailAssetUploadInput,
} from './index';

test('Asset input normalization blocks active content and detects supported image bytes', () => {
  assert.equal(normalizeAssetFileName(' C:\\fakepath\\atlas image.png '), 'atlas image.png');
  assert.equal(normalizeAssetContentType('IMAGE/PNG'), 'image/png');
  assert.throws(() => normalizeAssetContentType('image/svg+xml'));
  assert.equal(
    detectAssetImageContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/png',
  );
  assert.equal(detectAssetImageContentType(Buffer.from('<svg>')), undefined);
});

test('Asset upload session verifies size, SHA-256 and magic bytes before finalizing', async () => {
  const clock = new FixedClock('2026-08-31T00:00:00.000Z');
  const repository = new FakeAssetRepository();
  const storage = new FakeAssetStorage();
  const auditRepository = new InMemoryAuditRepository();
  const service = new AssetService(
    new PassthroughTransactionRunner(),
    repository,
    storage,
    new AuditService(auditRepository, clock),
    {
      privateBucket: 'atlas-private',
      uploadTtlSeconds: 900,
      maximumUploadBytes: 1024,
    },
    clock,
  );
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('atlas-phase-8'),
  ]);
  const sha256 = createHash('sha256').update(png).digest('hex');

  await requestContext.run(
    {
      requestId: createUuidV7(100),
      traceId: createUuidV7(101),
      actorType: ActorType.ADMIN,
      actorId: repository.adminId,
      workspaceId: repository.workspaceId,
    },
    async () => {
      const created = await service.createUploadSession(repository.workspaceId, {
        fileName: 'atlas.png',
        contentType: 'image/png',
        size: png.length,
        sha256,
      });

      assert.equal(created.asset.status, AssetStatus.UPLOADING);
      assert.equal(created.session.status, AssetUploadSessionStatus.PENDING);
      assert.equal(created.upload.method, 'PUT');
      assert.equal(created.upload.headers['Content-Type'], 'image/png');
      assert.equal(JSON.stringify(created).includes('temporaryObjectKey'), false);
      assert.equal(JSON.stringify(created).includes('originalObjectKey'), true);

      storage.body = png;
      storage.contentType = 'image/png';
      const completed = await service.completeUpload(repository.workspaceId, created.session.id);

      assert.equal(completed.status, AssetStatus.UPLOADED);
      assert.equal(completed.actualSize, png.length);
      assert.equal(completed.detectedContentType, 'image/png');
      assert.equal(storage.copied, true);
      assert.equal(storage.copyCount, 1);
      assert.equal(repository.aggregate?.session.status, AssetUploadSessionStatus.COMPLETED);

      if (!repository.aggregate) {
        throw new Error('Expected completed Asset aggregate.');
      }
      repository.aggregate.asset = {
        ...repository.aggregate.asset,
        status: AssetStatus.PROCESSING,
      };
      const repeated = await service.completeUpload(repository.workspaceId, created.session.id);

      assert.equal(repeated.status, AssetStatus.PROCESSING);
      assert.equal(storage.copyCount, 1);
      assert.deepEqual(
        auditRepository.records.map((record) => record.action),
        ['asset.upload-session-created', 'asset.upload-completed'],
      );
    },
  );
});

class InMemoryAuditRepository implements AuditRepositoryPort<void> {
  public readonly records: AuditRecord[] = [];

  public async insert(record: AuditRecord): Promise<void> {
    this.records.push(record);
  }
}

class FakeAssetStorage implements AssetObjectStoragePort {
  public body = Buffer.alloc(0);
  public contentType = 'image/png';
  public copyCount = 0;

  public get copied(): boolean {
    return this.copyCount > 0;
  }

  public async bucketExists(): Promise<boolean> {
    return true;
  }

  public async statObject() {
    return {
      size: this.body.length,
      etag: 'asset-etag',
      lastModified: new Date(),
      metadata: { 'content-type': this.contentType },
    };
  }

  public async createPresignedPutUrl(): Promise<string> {
    return 'http://localhost:9000/atlas-private/upload?signature=test';
  }

  public async getObjectStream(): Promise<Readable> {
    return Readable.from([this.body]);
  }

  public async copyObject(): Promise<void> {
    this.copyCount += 1;
  }

  public async removeObject(): Promise<void> {}
}

class FakeAssetRepository implements AssetRepositoryPort<void> {
  public readonly workspaceId = createUuidV7(1);
  public readonly adminId = createUuidV7(2);
  public aggregate?: AssetUploadAggregate;

  public async list(): Promise<readonly AssetRecord[]> {
    return this.aggregate ? [this.aggregate.asset] : [];
  }

  public async findById(): Promise<AssetRecord | undefined> {
    return this.aggregate?.asset;
  }

  public async insertUpload(asset: AssetRecord, session: AssetUploadSessionRecord): Promise<void> {
    this.aggregate = { asset: { ...asset }, session: { ...session } };
  }

  public async findUploadSessionForUpdate(): Promise<AssetUploadAggregate | undefined> {
    return this.aggregate
      ? {
          asset: { ...this.aggregate.asset },
          session: { ...this.aggregate.session },
        }
      : undefined;
  }

  public async completeUpload(
    _workspaceId: string,
    _uploadSessionId: string,
    input: CompleteAssetUploadInput,
  ): Promise<boolean> {
    if (!this.aggregate) return false;
    this.aggregate.asset = {
      ...this.aggregate.asset,
      status: AssetStatus.UPLOADED,
      detectedContentType: input.detectedContentType,
      actualSize: input.actualSize,
      originalEtag: input.originalEtag,
      version: this.aggregate.asset.version + 1,
      uploadedAt: input.completedAt,
      updatedAt: input.completedAt,
    };
    this.aggregate.session = {
      ...this.aggregate.session,
      status: AssetUploadSessionStatus.COMPLETED,
      completedAt: input.completedAt,
      updatedAt: input.completedAt,
    };
    return true;
  }

  public async failUpload(
    _workspaceId: string,
    _uploadSessionId: string,
    input: FailAssetUploadInput,
  ): Promise<boolean> {
    if (!this.aggregate) return false;
    this.aggregate.asset = {
      ...this.aggregate.asset,
      status: AssetStatus.FAILED,
      failedAt: input.failedAt,
      updatedAt: input.failedAt,
    };
    this.aggregate.session = {
      ...this.aggregate.session,
      status: AssetUploadSessionStatus.FAILED,
      failedAt: input.failedAt,
      failureCode: input.failureCode,
      updatedAt: input.failedAt,
    };
    return true;
  }
}
