import assert from 'node:assert/strict';
import { test } from 'node:test';

import sharp from 'sharp';

import { ASSET_IMAGE_VARIANT_SPECS, assetVariantContentType } from '@atlas/server';

import { SharpAssetImageProcessor } from './media/sharp-asset-image.processor';

test('Sharp processor creates the required metadata-free WebP and AVIF Variants', async () => {
  const source = await sharp({
    create: {
      width: 640,
      height: 480,
      channels: 4,
      background: { r: 24, g: 48, b: 72, alpha: 1 },
    },
  })
    .png()
    .withMetadata({ orientation: 1 })
    .toBuffer();
  const processor = new SharpAssetImageProcessor();
  const result = await processor.process({
    body: source,
    variants: ASSET_IMAGE_VARIANT_SPECS,
    limits: {
      maximumInputBytes: 1024 * 1024,
      maximumOutputBytes: 1024 * 1024,
      maximumPixels: 10_000_000,
      maximumDimension: 10_000,
    },
  });

  assert.equal(result.width, 640);
  assert.equal(result.height, 480);
  assert.equal(result.variants.length, ASSET_IMAGE_VARIANT_SPECS.length);

  for (const variant of result.variants) {
    const specification = ASSET_IMAGE_VARIANT_SPECS.find((item) => item.key === variant.key);
    assert.ok(specification);
    assert.equal(variant.format, specification.format);
    assert.equal(variant.contentType, assetVariantContentType(specification.format));
    assert.ok(variant.width <= specification.maximumWidth);
    assert.ok(variant.body.length > 0);

    const metadata = await sharp(variant.body).metadata();
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.xmp, undefined);
  }
});
