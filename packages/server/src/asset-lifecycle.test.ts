import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ActorType,
  AssetKind,
  AssetLifecycleService,
  AssetStatus,
  AuditService,
  FixedClock,
  PassthroughTransactionRunner,
  createUuidV7,
  requestContext,
  type AssetLifecycleRepositoryPort,
  type AssetRecord,
  type AssetUsageViewRecord,
  type AuditRecord,
  type AuditRepositoryPort,
} from './index';

const workspaceId = createUuidV7(1);
const assetId = createUuidV7(2);
const adminId = createUuidV7(3);

function readyAsset(): AssetRecord {
  const now = new Date('2026-09-04T00:00:00.000Z');

  return {
    id: assetId,
    workspaceId,
    kind: AssetKind.IMAGE,
    status: AssetStatus.READY,
    originalFileName: 'atlas.png',
    declaredContentType: 'image/png',
    detectedContentType: 'image/png',
    expectedSize: 100,
    actualSize: 100,
    sha256: 'a'.repeat(64),
    originalObjectKey: 'assets/workspace/asset/original',
    originalEtag: 'etag',
    width: 1280,
    height: 720,
    version: 4,
    createdByAdminAccountId: adminId,
    uploadedAt: now,
    processedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

class InMemoryAuditRepository implements AuditRepositoryPort<void> {
  public readonly records: AuditRecord[] = [];

  public async insert(record: AuditRecord): Promise<void> {
    this.records.push(record);
  }
}

class FakeLifecycleRepository implements AssetLifecycleRepositoryPort<void> {
  public asset = readyAsset();
  public activePublicationCount = 0;
  public archived = false;
  public usages: AssetUsageViewRecord[] = [];

  public async findForUpdate(): Promise<AssetRecord | undefined> {
    return { ...this.asset };
  }

  public async countActivePublicationUsages(): Promise<number> {
    return this.activePublicationCount;
  }

  public async archive(
    _workspaceId: string,
    _assetId: string,
    expectedVersion: number,
    archivedAt: Date,
  ): Promise<boolean> {
    if (this.asset.version !== expectedVersion || this.asset.archivedAt) return false;
    this.asset = {
      ...this.asset,
      version: expectedVersion + 1,
      archivedAt,
      updatedAt: archivedAt,
    };
    this.archived = true;
    return true;
  }

  public async listUsages(): Promise<readonly AssetUsageViewRecord[]> {
    return this.usages;
  }
}

test('Asset archive is blocked while an ACTIVE Publication uses the Asset', async () => {
  const clock = new FixedClock('2026-09-04T01:00:00.000Z');
  const repository = new FakeLifecycleRepository();
  const auditRepository = new InMemoryAuditRepository();
  repository.activePublicationCount = 1;
  const service = new AssetLifecycleService(
    new PassthroughTransactionRunner(),
    repository,
    new AuditService(auditRepository, clock),
    clock,
  );

  await requestContext.run(
    {
      requestId: createUuidV7(10),
      traceId: createUuidV7(11),
      actorType: ActorType.ADMIN,
      actorId: adminId,
      workspaceId,
    },
    async () => {
      await assert.rejects(service.archiveAsset(workspaceId, assetId, 4), /ACTIVE Publication/u);
    },
  );

  assert.equal(repository.archived, false);
  assert.equal(auditRepository.records.length, 0);
});

test('Asset archive increments the optimistic version and records Audit', async () => {
  const clock = new FixedClock('2026-09-04T01:00:00.000Z');
  const repository = new FakeLifecycleRepository();
  const auditRepository = new InMemoryAuditRepository();
  const service = new AssetLifecycleService(
    new PassthroughTransactionRunner(),
    repository,
    new AuditService(auditRepository, clock),
    clock,
  );

  const archived = await requestContext.run(
    {
      requestId: createUuidV7(20),
      traceId: createUuidV7(21),
      actorType: ActorType.ADMIN,
      actorId: adminId,
      workspaceId,
    },
    () => service.archiveAsset(workspaceId, assetId, 4),
  );

  assert.equal(archived.version, 5);
  assert.equal(archived.archivedAt?.toISOString(), '2026-09-04T01:00:00.000Z');
  assert.equal(repository.archived, true);
  assert.deepEqual(
    auditRepository.records.map((record) => record.action),
    ['asset.archived'],
  );
});
