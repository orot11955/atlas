import type { DataSource, EntityManager } from 'typeorm';

import {
  AssetStatus,
  AssetUploadSessionStatus,
  type AssetRecord,
  type AssetUploadAggregate,
  type AssetUploadSessionRecord,
} from '../../domain/asset';
import type {
  AssetRepositoryPort,
  CompleteAssetUploadInput,
  FailAssetUploadInput,
} from '../../ports/asset.repository';
import { AssetEntity, AssetUploadSessionEntity } from './asset.entities';

export class TypeOrmAssetRepository implements AssetRepositoryPort<EntityManager> {
  public constructor(private readonly dataSource: DataSource) {}

  public async list(workspaceId: string, limit: number): Promise<readonly AssetRecord[]> {
    const entities = await this.dataSource.getRepository(AssetEntity).find({
      where: { workspaceId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
    });
    return entities.map(toAssetRecord);
  }

  public async findById(
    workspaceId: string,
    assetId: string,
  ): Promise<AssetRecord | undefined> {
    const entity = await this.dataSource.getRepository(AssetEntity).findOne({
      where: { id: assetId, workspaceId },
    });
    return entity ? toAssetRecord(entity) : undefined;
  }

  public async insertUpload(
    asset: AssetRecord,
    session: AssetUploadSessionRecord,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(AssetEntity).insert({
      id: asset.id,
      workspaceId: asset.workspaceId,
      kind: asset.kind,
      status: asset.status,
      originalFileName: asset.originalFileName,
      declaredContentType: asset.declaredContentType,
      detectedContentType: asset.detectedContentType ?? null,
      expectedSize: asset.expectedSize,
      actualSize: asset.actualSize ?? null,
      sha256: asset.sha256,
      originalObjectKey: asset.originalObjectKey,
      originalEtag: asset.originalEtag ?? null,
      version: asset.version,
      createdByAdminAccountId: asset.createdByAdminAccountId,
      uploadedAt: asset.uploadedAt ?? null,
      failedAt: asset.failedAt ?? null,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    });
    await transaction.getRepository(AssetUploadSessionEntity).insert({
      id: session.id,
      workspaceId: session.workspaceId,
      assetId: session.assetId,
      status: session.status,
      temporaryObjectKey: session.temporaryObjectKey,
      expectedSize: session.expectedSize,
      expectedSha256: session.expectedSha256,
      declaredContentType: session.declaredContentType,
      expiresAt: session.expiresAt,
      completedAt: session.completedAt ?? null,
      failedAt: session.failedAt ?? null,
      failureCode: session.failureCode ?? null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
  }

  public async findUploadSessionForUpdate(
    workspaceId: string,
    uploadSessionId: string,
    transaction: EntityManager,
  ): Promise<AssetUploadAggregate | undefined> {
    const session = await transaction
      .getRepository(AssetUploadSessionEntity)
      .createQueryBuilder('uploadSession')
      .setLock('pessimistic_write')
      .where('uploadSession.id = :uploadSessionId', { uploadSessionId })
      .andWhere('uploadSession.workspace_id = :workspaceId', { workspaceId })
      .getOne();

    if (!session) {
      return undefined;
    }

    const asset = await transaction
      .getRepository(AssetEntity)
      .createQueryBuilder('asset')
      .setLock('pessimistic_write')
      .where('asset.id = :assetId', { assetId: session.assetId })
      .andWhere('asset.workspace_id = :workspaceId', { workspaceId })
      .getOne();

    return asset
      ? { asset: toAssetRecord(asset), session: toUploadSessionRecord(session) }
      : undefined;
  }

  public async completeUpload(
    workspaceId: string,
    uploadSessionId: string,
    input: CompleteAssetUploadInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const session = await transaction.getRepository(AssetUploadSessionEntity).findOne({
      where: {
        id: uploadSessionId,
        workspaceId,
        status: AssetUploadSessionStatus.PENDING,
      },
      select: { id: true, assetId: true },
    });

    if (!session) {
      return false;
    }

    const assetResult = await transaction.getRepository(AssetEntity).update(
      {
        id: session.assetId,
        workspaceId,
        status: AssetStatus.UPLOADING,
      },
      {
        status: AssetStatus.UPLOADED,
        detectedContentType: input.detectedContentType,
        actualSize: input.actualSize,
        originalEtag: input.originalEtag,
        version: () => 'version + 1',
        uploadedAt: input.completedAt,
        failedAt: null,
        updatedAt: input.completedAt,
      },
    );

    if ((assetResult.affected ?? 0) !== 1) {
      return false;
    }

    const sessionResult = await transaction.getRepository(AssetUploadSessionEntity).update(
      {
        id: uploadSessionId,
        workspaceId,
        status: AssetUploadSessionStatus.PENDING,
      },
      {
        status: AssetUploadSessionStatus.COMPLETED,
        completedAt: input.completedAt,
        failedAt: null,
        failureCode: null,
        updatedAt: input.completedAt,
      },
    );

    return (sessionResult.affected ?? 0) === 1;
  }

  public async failUpload(
    workspaceId: string,
    uploadSessionId: string,
    input: FailAssetUploadInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const session = await transaction.getRepository(AssetUploadSessionEntity).findOne({
      where: {
        id: uploadSessionId,
        workspaceId,
        status: AssetUploadSessionStatus.PENDING,
      },
      select: { id: true, assetId: true },
    });

    if (!session) {
      return false;
    }

    await transaction.getRepository(AssetEntity).update(
      {
        id: session.assetId,
        workspaceId,
        status: AssetStatus.UPLOADING,
      },
      {
        status: AssetStatus.FAILED,
        version: () => 'version + 1',
        failedAt: input.failedAt,
        updatedAt: input.failedAt,
      },
    );
    const result = await transaction.getRepository(AssetUploadSessionEntity).update(
      {
        id: uploadSessionId,
        workspaceId,
        status: AssetUploadSessionStatus.PENDING,
      },
      {
        status: AssetUploadSessionStatus.FAILED,
        failureCode: input.failureCode,
        failedAt: input.failedAt,
        updatedAt: input.failedAt,
      },
    );

    return (result.affected ?? 0) === 1;
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
    version: entity.version,
    createdByAdminAccountId: entity.createdByAdminAccountId,
    uploadedAt: entity.uploadedAt ? new Date(entity.uploadedAt) : undefined,
    failedAt: entity.failedAt ? new Date(entity.failedAt) : undefined,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

function toUploadSessionRecord(entity: AssetUploadSessionEntity): AssetUploadSessionRecord {
  return {
    id: entity.id,
    workspaceId: entity.workspaceId,
    assetId: entity.assetId,
    status: entity.status,
    temporaryObjectKey: entity.temporaryObjectKey,
    expectedSize: entity.expectedSize,
    expectedSha256: entity.expectedSha256,
    declaredContentType: entity.declaredContentType,
    expiresAt: new Date(entity.expiresAt),
    completedAt: entity.completedAt ? new Date(entity.completedAt) : undefined,
    failedAt: entity.failedAt ? new Date(entity.failedAt) : undefined,
    failureCode: entity.failureCode ?? undefined,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}
