import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AssetKind,
  AssetStatus,
  AssetVariantFormat,
  AssetVariantKey,
  AssetVariantService,
  createUuidV7,
  type AssetProcessingRepositoryPort,
  type AssetRecord,
  type AssetRepositoryPort,
  type AssetVariantRecord,
} from './index';

const workspaceId = createUuidV7(1);
const assetId = createUuidV7(2);

function readyAsset(): AssetRecord {
  const now = new Date('2026-09-01T00:00:00.000Z');

  return {
    id: assetId,
    workspaceId,
    kind: AssetKind.IMAGE,
    status: AssetStatus.READY,
    originalFileName: 'atlas.png',
    declaredContentType: 'image/png',
    detectedContentType: 'image/png',
    expectedSize: 10,
    actualSize: 10,
    sha256: 'a'.repeat(64),
    originalObjectKey: 'private/asset/original',
    originalEtag: 'original-etag',
    width: 1280,
    height: 720,
    version: 4,
    createdByAdminAccountId: createUuidV7(3),
    uploadedAt: now,
    processedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function variant(): AssetVariantRecord {
  const now = new Date('2026-09-01T00:00:00.000Z');

  return {
    id: createUuidV7(4),
    workspaceId,
    assetId,
    key: AssetVariantKey.WEBP_768,
    format: AssetVariantFormat.WEBP,
    contentType: 'image/webp',
    width: 768,
    height: 432,
    byteSize: 1234,
    sha256: 'b'.repeat(64),
    objectKey: 'assets/workspace/asset/variants/attempt/webp-768.webp',
    etag: 'variant-etag',
    createdAt: now,
  };
}

function createService(asset: AssetRecord | undefined, variants: readonly AssetVariantRecord[]) {
  const assetRepository = {
    findById: async () => asset,
  } as unknown as AssetRepositoryPort;
  const processingRepository = {
    findVariants: async () => variants,
  } as unknown as AssetProcessingRepositoryPort;

  return new AssetVariantService(assetRepository, processingRepository, {
    buildPublicUrl: (objectKey) => `https://assets.atlas.test/${objectKey}`,
  });
}

test('Asset Variant query returns public views without Object keys', async () => {
  const result = await createService(readyAsset(), [variant()]).listVariants(workspaceId, assetId);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.key, AssetVariantKey.WEBP_768);
  assert.equal(
    result[0]?.publicUrl,
    'https://assets.atlas.test/assets/workspace/asset/variants/attempt/webp-768.webp',
  );
  assert.equal(JSON.stringify(result).includes('objectKey'), false);
  assert.equal(JSON.stringify(result).includes('private/asset/original'), false);
});

test('Asset Variant query returns no public Variant before Asset READY', async () => {
  const uploaded = { ...readyAsset(), status: AssetStatus.UPLOADED, processedAt: undefined };
  const result = await createService(uploaded, [variant()]).listVariants(workspaceId, assetId);

  assert.deepEqual(result, []);
});

test('Asset Variant query rejects an unknown Workspace Asset', async () => {
  await assert.rejects(
    createService(undefined, []).listVariants(workspaceId, assetId),
    /Asset was not found/u,
  );
});
