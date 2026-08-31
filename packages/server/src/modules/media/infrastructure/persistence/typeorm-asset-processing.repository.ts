import type { DataSource, EntityManager } from 'typeorm';

import { AssetStatus, canProcessAsset, type AssetRecord } from '../../domain/asset';
import {
  AssetProcessingAttemptStatus,
  type AssetProcessingAttemptRecord,
  type AssetVariantRecord,
} from '../../domain/asset-processing';
import type {
  AssetProcessingRepositoryPort,
  ClaimAssetProcessingInput,
  ClaimAssetProcessingResult,
  CompleteAssetProcessingInput,
  FailAssetProcessingInput,
} from '../../ports/asset-processing.repository';
import { AssetEntity } from './asset.entities';
import { AssetProcessingAttemptEntity, AssetVariantEntity } from './asset-processing.entities';

export class TypeOrmAssetProcessingRepository
  implements AssetProcessingRepositoryPort<EntityManager>
{
  public constructor(private readonly dataSource: DataSource) {}

  public async findVariants(
    workspaceId: string,
    assetId: string,
  ): Promise<readonly AssetVariantRecord[]> {
    const entities = await this.dataSource.getRepository(AssetVariantEntity).find({
      where: { workspaceId, assetId },
      order: { key: 'ASC' },
    });

    return entities.map(toVariantRecord);
  }

  public async claim(
    workspaceId: string,
    assetId: string,
    input: ClaimAssetProcessingInput,
    transaction: EntityManager,
  ): Promise<ClaimAssetProcessingResult> {
    const assetRepository = transaction.getRepository(AssetEntity);
    const attemptRepository = transaction.getRepository(AssetProcessingAttemptEntity);
    const asset = await assetRepository
      .createQueryBuilder('asset')
      .setLock('pessimistic_write')
      .where('asset.id = :assetId', { assetId })
      .andWhere('asset.workspace_id = :workspaceId', { workspaceId })
      .getOne();

    if (!asset) {
      return Object.freeze({ kind: 'missing' as const });
    }

    if (asset.status === AssetStatus.READY) {
      const variants = await transaction.getRepository(AssetVariantEntity).find({
        where: { workspaceId, assetId },
        order: { key: 'ASC' },
      });

      return Object.freeze({
        kind: 'already-ready' as const,
        asset: toAssetRecord(asset),
        variants: Object.freeze(variants.map(toVariantRecord)),
      });
    }

    if (asset.status === AssetStatus.PROCESSING) {
      const activeAttempt = await attemptRepository.findOne({
        where: {
          workspaceId,
          assetId,
          status: AssetProcessingAttemptStatus.PROCESSING,
        },
        order: { attemptNumber: 'DESC' },
      });

      if (
        !activeAttempt ||
        new Date(activeAttempt.startedAt).getTime() > input.staleBefore.getTime()
      ) {
        return Object.freeze({
          kind: 'busy' as const,
          asset: toAssetRecord(asset),
        });
      }

      await attemptRepository.update(
        {
          id: activeAttempt.id,
          workspaceId,
          status: AssetProcessingAttemptStatus.PROCESSING,
        },
        {
          status: AssetProcessingAttemptStatus.FAILED,
          failedAt: input.startedAt,
          failureCode: 'asset_processing_stale',
          updatedAt: input.startedAt,
        },
      );
      await assetRepository.update(
        {
          id: assetId,
          workspaceId,
          status: AssetStatus.PROCESSING,
        },
        {
          status: AssetStatus.UPLOADED,
          processingFailureCode: null,
          failedAt: null,
          version: () => 'version + 1',
          updatedAt: input.startedAt,
        },
      );

      asset.status = AssetStatus.UPLOADED;
      asset.processingFailureCode = null;
      asset.failedAt = null;
      asset.version += 1;
      asset.updatedAt = input.startedAt;
    }

    const assetRecord = toAssetRecord(asset);

    if (!canProcessAsset(assetRecord)) {
      return Object.freeze({
        kind: 'not-processable' as const,
        asset: assetRecord,
      });
    }

    const rawMaximum = await attemptRepository
      .createQueryBuilder('attempt')
      .select('COALESCE(MAX(attempt.attempt_number), 0)', 'maximum')
      .where('attempt.asset_id = :assetId', { assetId })
      .andWhere('attempt.workspace_id = :workspaceId', { workspaceId })
      .getRawOne<{ maximum: string | number }>();
    const attemptNumber = Number(rawMaximum?.maximum ?? 0) + 1;
    const attempt: AssetProcessingAttemptRecord = {
      id: input.attemptId,
      workspaceId,
      assetId,
      jobId: input.jobId,
      attemptNumber,
      status: AssetProcessingAttemptStatus.PROCESSING,
      startedAt: input.startedAt,
      createdAt: input.startedAt,
      updatedAt: input.startedAt,
    };

    await attemptRepository.insert({
      id: attempt.id,
      workspaceId: attempt.workspaceId,
      assetId: attempt.assetId,
      jobId: attempt.jobId,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      startedAt: attempt.startedAt,
      completedAt: null,
      failedAt: null,
      failureCode: null,
      createdAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
    });

    const claimed = await assetRepository.update(
      {
        id: assetId,
        workspaceId,
        status: asset.status,
      },
      {
        status: AssetStatus.PROCESSING,
        processingFailureCode: null,
        failedAt: null,
        version: () => 'version + 1',
        updatedAt: input.startedAt,
      },
    );

    if ((claimed.affected ?? 0) !== 1) {
      return Object.freeze({
        kind: 'busy' as const,
        asset: assetRecord,
      });
    }

    return Object.freeze({
      kind: 'claimed' as const,
      asset: {
        ...assetRecord,
        status: AssetStatus.PROCESSING,
        processingFailureCode: undefined,
        failedAt: undefined,
        version: assetRecord.version + 1,
        updatedAt: input.startedAt,
      },
      attempt,
    });
  }

  public async complete(
    workspaceId: string,
    assetId: string,
    input: CompleteAssetProcessingInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const attemptResult = await transaction.getRepository(AssetProcessingAttemptEntity).update(
      {
        id: input.attemptId,
        workspaceId,
        assetId,
        status: AssetProcessingAttemptStatus.PROCESSING,
      },
      {
        status: AssetProcessingAttemptStatus.SUCCEEDED,
        completedAt: input.completedAt,
        failedAt: null,
        failureCode: null,
        updatedAt: input.completedAt,
      },
    );

    if ((attemptResult.affected ?? 0) !== 1) {
      return false;
    }

    const variantRepository = transaction.getRepository(AssetVariantEntity);
    await variantRepository.delete({ workspaceId, assetId });
    await variantRepository.insert(
      input.variants.map((variant) => ({
        id: variant.id,
        workspaceId: variant.workspaceId,
        assetId: variant.assetId,
        key: variant.key,
        format: variant.format,
        contentType: variant.contentType,
        width: variant.width,
        height: variant.height,
        byteSize: variant.byteSize,
        sha256: variant.sha256,
        objectKey: variant.objectKey,
        etag: variant.etag,
        createdAt: variant.createdAt,
      })),
    );

    const assetResult = await transaction.getRepository(AssetEntity).update(
      {
        id: assetId,
        workspaceId,
        status: AssetStatus.PROCESSING,
      },
      {
        status: AssetStatus.READY,
        width: input.width,
        height: input.height,
        processingFailureCode: null,
        processedAt: input.completedAt,
        failedAt: null,
        version: () => 'version + 1',
        updatedAt: input.completedAt,
      },
    );

    return (assetResult.affected ?? 0) === 1;
  }

  public async fail(
    workspaceId: string,
    assetId: string,
    input: FailAssetProcessingInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const attemptResult = await transaction.getRepository(AssetProcessingAttemptEntity).update(
      {
        id: input.attemptId,
        workspaceId,
        assetId,
        status: AssetProcessingAttemptStatus.PROCESSING,
      },
      {
        status: AssetProcessingAttemptStatus.FAILED,
        completedAt: null,
        failedAt: input.failedAt,
        failureCode: input.failureCode,
        updatedAt: input.failedAt,
      },
    );

    if ((attemptResult.affected ?? 0) !== 1) {
      return false;
    }

    const assetResult = await transaction.getRepository(AssetEntity).update(
      {
        id: assetId,
        workspaceId,
        status: AssetStatus.PROCESSING,
      },
      {
        status: input.finalAttempt ? AssetStatus.FAILED : AssetStatus.UPLOADED,
        width: null,
        height: null,
        processedAt: null,
        processingFailureCode: input.finalAttempt ? input.failureCode : null,
        failedAt: input.finalAttempt ? input.failedAt : null,
        version: () => 'version + 1',
        updatedAt: input.failedAt,
      },
    );

    return (assetResult.affected ?? 0) === 1;
  }
}

function toAssetRecord(entity: AssetEntity): AssetRecord {
  return {
    id: entity.id,
    workspaceId: entity.workspaceId,
    kind: entity.kind,
    status: entity.status,
    originalFileName: entity.originalFileName,
    declaredContentType: entity.declaredContentType,
    detectedContentType: entity.detectedContentType ?? undefined,
    expectedSize: entity.expectedSize,
    actualSize: entity.actualSize ?? undefined,
    sha256: entity.sha256,
    originalObjectKey: entity.originalObjectKey,
    originalEtag: entity.originalEtag ?? undefined,
    width: entity.width ?? undefined,
    height: entity.height ?? undefined,
    processingFailureCode: entity.processingFailureCode ?? undefined,
    version: entity.version,
    createdByAdminAccountId: entity.createdByAdminAccountId,
    uploadedAt: entity.uploadedAt ? new Date(entity.uploadedAt) : undefined,
    processedAt: entity.processedAt ? new Date(entity.processedAt) : undefined,
    failedAt: entity.failedAt ? new Date(entity.failedAt) : undefined,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

function toVariantRecord(entity: AssetVariantEntity): AssetVariantRecord {
  return {
    id: entity.id,
    workspaceId: entity.workspaceId,
    assetId: entity.assetId,
    key: entity.key,
    format: entity.format,
    contentType: entity.contentType,
    width: entity.width,
    height: entity.height,
    byteSize: entity.byteSize,
    sha256: entity.sha256,
    objectKey: entity.objectKey,
    etag: entity.etag,
    createdAt: new Date(entity.createdAt),
  };
}
