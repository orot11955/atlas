import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AssetKind,
  AssetStatus,
  AssetUsageKind,
  DomainError,
  assertContentAssetReferencesReady,
  createUuidV7,
  parseContentAssetReferences,
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
