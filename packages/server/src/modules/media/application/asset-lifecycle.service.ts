import type { AuditService, Clock, TransactionRunner } from '../../../core';
import {
  ActorType,
  AuditResult,
  DomainError,
  ErrorCode,
  requestContext,
  systemClock,
} from '../../../core';
import { assertAssetArchivable, type AssetRecord } from '../domain/asset';
import type { AssetUsageViewRecord } from '../domain/asset-lifecycle';
import type { AssetLifecycleRepositoryPort } from '../ports/asset-lifecycle.repository';

export class AssetLifecycleService<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: AssetLifecycleRepositoryPort<TTransaction>,
    private readonly auditService: AuditService<TTransaction>,
    private readonly clock: Clock = systemClock,
  ) {}

  public async listUsages(
    workspaceId: string,
    assetId: string,
  ): Promise<readonly Readonly<AssetUsageViewRecord>[]> {
    const usages = await this.repository.listUsages(workspaceId, assetId);
    return Object.freeze(usages.map(freezeUsage));
  }

  public async archiveAsset(
    workspaceId: string,
    assetId: string,
    version: number,
  ): Promise<Readonly<AssetRecord>> {
    assertPositiveVersion(version);
    requireAdminActorId();
    const archivedAt = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const asset = await this.repository.findForUpdate(workspaceId, assetId, transaction);

      if (!asset) {
        throw assetNotFoundError();
      }

      if (asset.version !== version) {
        throw versionConflictError();
      }

      if (asset.archivedAt) {
        return freezeAsset(asset);
      }

      const activePublicationCount = await this.repository.countActivePublicationUsages(
        workspaceId,
        assetId,
        transaction,
      );
      assertAssetArchivable(asset, activePublicationCount);

      const archived = await this.repository.archive(
        workspaceId,
        assetId,
        version,
        archivedAt,
        transaction,
      );

      if (!archived) {
        throw versionConflictError();
      }

      await this.auditService.record(
        {
          action: 'asset.archived',
          targetType: 'asset',
          targetId: assetId,
          result: AuditResult.SUCCESS,
          metadata: {
            version: version + 1,
            activePublicationCount,
          },
        },
        transaction,
      );

      return freezeAsset({
        ...asset,
        archivedAt,
        version: version + 1,
        updatedAt: archivedAt,
      });
    });
  }
}

function freezeUsage(usage: AssetUsageViewRecord): Readonly<AssetUsageViewRecord> {
  return Object.freeze({ ...usage, createdAt: new Date(usage.createdAt) });
}

function freezeAsset(asset: AssetRecord): Readonly<AssetRecord> {
  return Object.freeze({
    ...asset,
    uploadedAt: asset.uploadedAt ? new Date(asset.uploadedAt) : undefined,
    processedAt: asset.processedAt ? new Date(asset.processedAt) : undefined,
    failedAt: asset.failedAt ? new Date(asset.failedAt) : undefined,
    archivedAt: asset.archivedAt ? new Date(asset.archivedAt) : undefined,
    createdAt: new Date(asset.createdAt),
    updatedAt: new Date(asset.updatedAt),
  });
}

function requireAdminActorId(): string {
  const context = requestContext.require();

  if (context.actorType !== ActorType.ADMIN || !context.actorId) {
    throw new DomainError({
      code: ErrorCode.AUTH_REQUIRED,
      message: 'An authenticated administrator is required.',
    });
  }

  return context.actorId;
}

function assertPositiveVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Asset version must be a positive safe integer.',
      details: { field: 'version' },
    });
  }
}

function assetNotFoundError(): DomainError {
  return new DomainError({ code: ErrorCode.NOT_FOUND, message: 'Asset was not found.' });
}

function versionConflictError(): DomainError {
  return new DomainError({
    code: ErrorCode.VERSION_CONFLICT,
    message: 'Asset was changed by another request.',
  });
}
