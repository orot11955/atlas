import type {
  AssetImageVariantSpec,
  AssetVariantContentType,
  AssetVariantFormat,
  AssetVariantKey,
} from '../domain/asset-processing';

export interface AssetImageProcessingLimits {
  maximumInputBytes: number;
  maximumOutputBytes: number;
  maximumPixels: number;
  maximumDimension: number;
}

export interface ProcessAssetImageInput {
  body: Buffer;
  variants: readonly Readonly<AssetImageVariantSpec>[];
  limits: Readonly<AssetImageProcessingLimits>;
}

export interface ProcessedAssetImageVariant {
  key: AssetVariantKey;
  format: AssetVariantFormat;
  contentType: AssetVariantContentType;
  width: number;
  height: number;
  body: Buffer;
}

export interface ProcessedAssetImage {
  width: number;
  height: number;
  variants: readonly Readonly<ProcessedAssetImageVariant>[];
}

export interface AssetImageProcessorPort {
  process(input: Readonly<ProcessAssetImageInput>): Promise<Readonly<ProcessedAssetImage>>;
}
