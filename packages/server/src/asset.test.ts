import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  detectAssetImageContentType,
  normalizeAssetContentType,
  normalizeAssetExpectedSize,
  normalizeAssetFileName,
  normalizeAssetSha256,
} from './index';

test('Asset upload input accepts only normalized JPEG, PNG and WebP contracts', () => {
  assert.equal(normalizeAssetFileName(' C:\\fakepath\\atlas image.png '), 'atlas image.png');
  assert.equal(normalizeAssetContentType('IMAGE/PNG'), 'image/png');
  assert.equal(normalizeAssetExpectedSize(1024, 2048), 1024);
  assert.equal(normalizeAssetSha256('A'.repeat(64)), 'a'.repeat(64));
  assert.throws(() => normalizeAssetContentType('image/svg+xml'));
  assert.throws(() => normalizeAssetExpectedSize(2049, 2048));
});

test('Asset image detection uses magic bytes instead of the file extension', () => {
  assert.equal(
    detectAssetImageContentType(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
    'image/png',
  );
  assert.equal(detectAssetImageContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(detectAssetImageContentType(Buffer.from('RIFF0000WEBP', 'ascii')), 'image/webp');
  assert.equal(detectAssetImageContentType(Buffer.from('<svg></svg>')), undefined);
});
