import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ASSET_IMAGE_VARIANT_SPECS,
  AssetKind,
  AssetStatus,
  AssetUsageKind,
  DomainError,
  assertContentAssetReferencesReady,
  assetVariantContentType,
  createContentPublicationAssetManifest,
  createUuidV7,
  parseContentAssetReferences,
  renderContentPublicationBodyHtml,
} from './index';

test('Content Asset references parse Markdown images and ignore code examples', () => {
  const firstAssetId = createUuidV7(1);
  const secondAssetId = createUuidV7(2);
  const references = parseContentAssetReferences(`
# Atlas Media

![  Main   cover  ](asset://${firstAssetId} "  Main   caption  ")

Inline code: \`![ignored](asset://${secondAssetId})\`

\`\`\`markdown
![also ignored](asset://${secondAssetId})
\`\`\`

![](asset://${secondAssetId})
`);

  assert.deepEqual(references, [
    {
      assetId: firstAssetId,
      kind: AssetUsageKind.INLINE,
      ordinal: 1,
      altText: 'Main cover',
      caption: 'Main caption',
    },
    {
      assetId: secondAssetId,
      kind: AssetUsageKind.INLINE,
      ordinal: 2,
      altText: '',
    },
  ]);
});

test('Content Asset references reject raw or malformed asset schemes', () => {
  const assetId = createUuidV7(10);

  assert.throws(() => parseContentAssetReferences(`[Asset](asset://${assetId})`), DomainError);
  assert.throws(() => parseContentAssetReferences(`asset://${assetId}`), DomainError);
});

test('READY Content accepts only Workspace-scoped READY image Assets', () => {
  const readyAssetId = createUuidV7(20);
  const failedAssetId = createUuidV7(21);
  const references = parseContentAssetReferences(`
![Ready](asset://${readyAssetId})
![Failed](asset://${failedAssetId})
`);

  assert.throws(
    () =>
      assertContentAssetReferencesReady(references, [
        {
          id: readyAssetId,
          kind: AssetKind.IMAGE,
          status: AssetStatus.READY,
        },
        {
          id: failedAssetId,
          kind: AssetKind.IMAGE,
          status: AssetStatus.FAILED,
        },
      ]),
    DomainError,
  );

  assert.doesNotThrow(() =>
    assertContentAssetReferencesReady(references.slice(0, 1), [
      {
        id: readyAssetId,
        kind: AssetKind.IMAGE,
        status: AssetStatus.READY,
      },
    ]),
  );
});

test('Publication Asset Manifest snapshots all public variants and renders immutable picture HTML', () => {
  const workspaceId = createUuidV7(30);
  const revisionId = createUuidV7(31);
  const assetId = createUuidV7(32);
  const usageId = createUuidV7(33);
  const manifest = createContentPublicationAssetManifest(
    [
      {
        usage: {
          id: usageId,
          workspaceId,
          assetId,
          revisionId,
          ordinal: 1,
          kind: AssetUsageKind.INLINE,
          altText: 'Atlas <cover>',
          caption: 'Public & immutable',
          createdAt: new Date(1),
        },
        variants: ASSET_IMAGE_VARIANT_SPECS.map((spec, index) => ({
          id: createUuidV7(40 + index),
          workspaceId,
          assetId,
          key: spec.key,
          format: spec.format,
          contentType: assetVariantContentType(spec.format),
          width: Math.min(spec.maximumWidth, 1_200),
          height: Math.min(spec.maximumWidth, 1_200) * 0.75,
          byteSize: 1_024 + index,
          sha256: String(index).repeat(64),
          objectKey: `assets/${workspaceId}/${assetId}/variants/${spec.key}.${spec.format}`,
          etag: `etag-${index}`,
          createdAt: new Date(2 + index),
        })),
      },
    ],
    (objectKey) => `https://assets.atlas.test/${objectKey}`,
  );

  assert.equal(manifest.length, 1);
  assert.equal(manifest[0]?.variants.length, ASSET_IMAGE_VARIANT_SPECS.length);

  const bodyHtml = renderContentPublicationBodyHtml(
    `# Media\n\n![Atlas <cover>](asset://${assetId} "Public & immutable")`,
    manifest,
  );

  assert.match(bodyHtml, /<picture data-asset-id=/u);
  assert.match(bodyHtml, /<source type="image\/avif"/u);
  assert.match(bodyHtml, /<source type="image\/webp"/u);
  assert.match(bodyHtml, /alt="Atlas &lt;cover&gt;"/u);
  assert.match(bodyHtml, /title="Public &amp; immutable"/u);
  assert.doesNotMatch(bodyHtml, /asset:\/\//u);
});

test('Publication Asset Manifest rejects incomplete Variant sets', () => {
  const workspaceId = createUuidV7(60);
  const revisionId = createUuidV7(61);
  const assetId = createUuidV7(62);

  assert.throws(
    () =>
      createContentPublicationAssetManifest(
        [
          {
            usage: {
              id: createUuidV7(63),
              workspaceId,
              assetId,
              revisionId,
              ordinal: 1,
              kind: AssetUsageKind.INLINE,
              altText: '',
              createdAt: new Date(1),
            },
            variants: [],
          },
        ],
        (objectKey) => `https://assets.atlas.test/${objectKey}`,
      ),
    DomainError,
  );
});
