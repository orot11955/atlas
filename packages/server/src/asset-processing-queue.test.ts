import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ActorType,
  AssetKind,
  AssetStatus,
  AssetUploadCoordinator,
  createUuidV7,
  requestContext,
  type AssetProcessingQueuePort,
  type AssetRecord,
  type EnqueueAssetProcessingInput,
} from './index';

test('Asset upload completion enqueues one idempotent media processing job', async () => {
  const workspaceId = createUuidV7(1);
  const assetId = createUuidV7(2);
  const queue = new FakeAssetProcessingQueue();
  const asset = createAsset(workspaceId, assetId, AssetStatus.UPLOADED, 2);
  const coordinator = new AssetUploadCoordinator(
    {
      completeUpload: async () => asset,
    },
    queue,
  );

  const completed = await requestContext.run(
    {
      requestId: createUuidV7(3),
      traceId: createUuidV7(4),
      correlationId: 'media-upload-correlation',
      actorType: ActorType.ADMIN,
      actorId: createUuidV7(5),
      workspaceId,
    },
    () => coordinator.completeUpload(workspaceId, createUuidV7(6)),
  );

  assert.equal(completed, asset);
  assert.deepEqual(queue.inputs, [
    {
      workspaceId,
      assetId,
      assetVersion: 2,
      correlationId: 'media-upload-correlation',
    },
  ]);
});

test('Asset upload completion does not enqueue when processing already started', async () => {
  const workspaceId = createUuidV7(10);
  const assetId = createUuidV7(11);
  const queue = new FakeAssetProcessingQueue();
  const asset = createAsset(workspaceId, assetId, AssetStatus.PROCESSING, 3);
  const coordinator = new AssetUploadCoordinator(
    {
      completeUpload: async () => asset,
    },
    queue,
  );

  await coordinator.completeUpload(workspaceId, createUuidV7(12));

  assert.deepEqual(queue.inputs, []);
});

class FakeAssetProcessingQueue implements AssetProcessingQueuePort {
  public readonly inputs: EnqueueAssetProcessingInput[] = [];

  public async enqueue(input: Readonly<EnqueueAssetProcessingInput>): Promise<void> {
    this.inputs.push({ ...input });
  }
}

function createAsset(
  workspaceId: string,
  id: string,
  status: AssetRecord['status'],
  version: number,
): AssetRecord {
  const now = new Date('2026-08-31T00:00:00.000Z');

  return {
    id,
    workspaceId,
    kind: AssetKind.IMAGE,
    status,
    originalFileName: 'atlas.png',
    declaredContentType: 'image/png',
    detectedContentType: 'image/png',
    expectedSize: 8,
    actualSize: 8,
    sha256: 'a'.repeat(64),
    originalObjectKey: `assets/${workspaceId}/${id}/original`,
    originalEtag: 'etag',
    version,
    createdByAdminAccountId: createUuidV7(20),
    uploadedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}
