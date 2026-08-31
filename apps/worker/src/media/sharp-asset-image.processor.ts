import sharp, { type Metadata } from 'sharp';

import {
  AssetVariantFormat,
  DomainError,
  ErrorCode,
  assetVariantContentType,
  normalizeAssetProcessingFailureCode,
  type AssetImageProcessorPort,
  type ProcessAssetImageInput,
  type ProcessedAssetImage,
  type ProcessedAssetImageVariant,
} from '@atlas/server';

export class SharpAssetImageProcessor implements AssetImageProcessorPort {
  public async process(
    input: Readonly<ProcessAssetImageInput>,
  ): Promise<Readonly<ProcessedAssetImage>> {
    if (input.body.length < 1 || input.body.length > input.limits.maximumInputBytes) {
      throw processingFailure(
        'asset_processing_input_size_invalid',
        'Asset image input exceeds the processing size limit.',
      );
    }

    const metadata = await readMetadata(input);
    assertSupportedMetadata(metadata, input);
    const dimensions = readVisualDimensions(metadata);
    const variants: ProcessedAssetImageVariant[] = [];

    for (const specification of input.variants) {
      try {
        const pipeline = sharp(input.body, sharpOptions(input)).rotate().resize({
          width: specification.maximumWidth,
          fit: 'inside',
          withoutEnlargement: true,
        });
        const output =
          specification.format === AssetVariantFormat.AVIF
            ? pipeline.avif({ quality: specification.quality, effort: 4 })
            : pipeline.webp({ quality: specification.quality, effort: 4 });
        const generated = await output.toBuffer({ resolveWithObject: true });

        assertOutput(generated.info.width, generated.info.height, generated.data.length, input);
        variants.push({
          key: specification.key,
          format: specification.format,
          contentType: assetVariantContentType(specification.format),
          width: generated.info.width,
          height: generated.info.height,
          body: generated.data,
        });
      } catch (cause) {
        if (cause instanceof DomainError) {
          throw cause;
        }

        throw processingFailure(
          'asset_variant_encode_failed',
          'Asset image Variant encoding failed.',
          cause,
        );
      }
    }

    return Object.freeze({
      width: dimensions.width,
      height: dimensions.height,
      variants: Object.freeze(variants),
    });
  }
}

async function readMetadata(input: Readonly<ProcessAssetImageInput>): Promise<Metadata> {
  try {
    return await sharp(input.body, sharpOptions(input)).metadata();
  } catch (cause) {
    throw processingFailure('asset_decode_failed', 'Asset image decoding failed.', cause);
  }
}

function sharpOptions(input: Readonly<ProcessAssetImageInput>) {
  return {
    animated: false,
    failOn: 'warning' as const,
    limitInputPixels: input.limits.maximumPixels,
    sequentialRead: true,
  };
}

function assertSupportedMetadata(
  metadata: Metadata,
  input: Readonly<ProcessAssetImageInput>,
): void {
  if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
    throw processingFailure(
      'asset_decode_format_unsupported',
      'Decoded Asset image format is not supported.',
    );
  }

  if ((metadata.pages ?? 1) !== 1) {
    throw processingFailure(
      'asset_animated_image_unsupported',
      'Animated or multi-page Asset images are not supported.',
    );
  }

  const dimensions = readVisualDimensions(metadata);
  assertDimension(dimensions.width, input.limits.maximumDimension);
  assertDimension(dimensions.height, input.limits.maximumDimension);

  if (dimensions.width * dimensions.height > input.limits.maximumPixels) {
    throw processingFailure(
      'asset_pixel_limit_exceeded',
      'Decoded Asset image exceeds the pixel limit.',
    );
  }
}

function readVisualDimensions(metadata: Metadata): { width: number; height: number } {
  if (!metadata.width || !metadata.height) {
    throw processingFailure(
      'asset_dimensions_missing',
      'Decoded Asset image dimensions are missing.',
    );
  }

  const orientation = metadata.orientation ?? 1;
  const rotated = orientation >= 5 && orientation <= 8;

  return rotated
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height };
}

function assertOutput(
  width: number,
  height: number,
  byteSize: number,
  input: Readonly<ProcessAssetImageInput>,
): void {
  assertDimension(width, input.limits.maximumDimension);
  assertDimension(height, input.limits.maximumDimension);

  if (
    width * height > input.limits.maximumPixels ||
    byteSize < 1 ||
    byteSize > input.limits.maximumOutputBytes
  ) {
    throw processingFailure(
      'asset_variant_output_limit_exceeded',
      'Encoded Asset image Variant exceeds the output limit.',
    );
  }
}

function assertDimension(value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw processingFailure(
      'asset_dimension_limit_exceeded',
      'Decoded Asset image dimension exceeds the limit.',
    );
  }
}

function processingFailure(code: string, message: string, cause?: unknown): DomainError {
  return new DomainError({
    code: ErrorCode.INTERNAL_ERROR,
    message,
    details: { failureCode: normalizeAssetProcessingFailureCode(code) },
    cause,
  });
}
