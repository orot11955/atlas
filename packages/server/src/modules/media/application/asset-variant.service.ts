import { DomainError, ErrorCode } from '../../../core';
import { AssetStatus } from '../domain/asset';
import type {
  AssetVariantContentType,
  AssetVariantFormat,
  AssetVariantKey,
} from '../domain/asset-processing';
import type { AssetProcessingRepositoryPort } from '../ports/asset-processing.repository';
import type { AssetPublicUrlBuilderPort } from '../ports/asset-public-url-builder.port';
import type { AssetRepositoryPort } from '../ports/asset.repository';

export interface AssetVariantView {
  key: AssetVariantKey;
  format: AssetVariantFormat;
  contentType: AssetVariantContentType;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
  etag: string;
  publicUrl: string;
}

export class AssetVariantService<TTransaction = unknown> {
  public constructor(
    private readonly assetRepository: AssetRepositoryPort<TTransaction>,
    private readonly processingRepository: AssetProcessingRepositoryPort<TTransaction>,
    private readonly publicUrlBuilder: AssetPublicUrlBuilderPort,
  ) {}

  public async listVariants(
    workspaceId: string,
    assetId: string,
  ): Promise<readonly Readonly<AssetVariantView>[]> {
    const asset = await this.assetRepository.findById(workspaceId, assetId);

    if (!asset) {
      throw new DomainError({
        code: ErrorCode.NOT_FOUND,
        message: 'Asset was not found.',
      });
    }

    if (asset.status !== AssetStatus.READY) {
      return Object.freeze([]);
    }

    const variants = await this.processingRepository.findVariants(workspaceId, assetId);

    return Object.freeze(
      variants.map((variant) =>
        Object.freeze({
          key: variant.key,
          format: variant.format,
          contentType: variant.contentType,
          width: variant.width,
          height: variant.height,
          byteSize: variant.byteSize,
          sha256: variant.sha256,
          etag: variant.etag,
          publicUrl: this.publicUrlBuilder.buildPublicUrl(variant.objectKey),
        }),
      ),
    );
  }
}
