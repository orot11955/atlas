import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAssetMarkdownReference } from './features/content/content-asset-picker';

test('Content Asset Picker creates a Markdown image Reference', () => {
  assert.equal(
    createAssetMarkdownReference('01999999-9999-7999-8999-999999999999', 'Atlas image'),
    '![Atlas image](asset://01999999-9999-7999-8999-999999999999)',
  );
});

test('Content Asset Picker escapes Alt Text and Caption', () => {
  assert.equal(
    createAssetMarkdownReference(
      '01999999-9999-7999-8999-999999999999',
      'Atlas [private] image',
      'Original "caption"\nwithout metadata',
    ),
    '![Atlas \\[private\\] image](asset://01999999-9999-7999-8999-999999999999 "Original \\"caption\\" without metadata")',
  );
});

test('Content Asset Picker requires Alt Text', () => {
  assert.throws(
    () => createAssetMarkdownReference('01999999-9999-7999-8999-999999999999', '  '),
    /Alt Text/u,
  );
});
