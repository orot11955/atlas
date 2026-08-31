import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type {
  AssetProcessingAttemptStatus,
  AssetVariantContentType,
  AssetVariantFormat,
  AssetVariantKey,
} from '../../domain/asset-processing';

const bigintNumberTransformer = {
  to: (value: number) => value,
  from: (value: string | number) => Number(value),
};

@Entity({ name: 'asset_variants' })
@Index('idx_asset_variants_workspace_asset', ['workspaceId', 'assetId'])
export class AssetVariantEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ name: 'asset_id', type: 'uuid' })
  public assetId!: string;

  @Column({ name: 'variant_key', type: 'varchar', length: 32 })
  public key!: AssetVariantKey;

  @Column({ type: 'varchar', length: 16 })
  public format!: AssetVariantFormat;

  @Column({ name: 'content_type', type: 'varchar', length: 100 })
  public contentType!: AssetVariantContentType;

  @Column({ type: 'integer' })
  public width!: number;

  @Column({ type: 'integer' })
  public height!: number;

  @Column({
    name: 'byte_size',
    type: 'bigint',
    transformer: bigintNumberTransformer,
  })
  public byteSize!: number;

  @Column({ type: 'char', length: 64 })
  public sha256!: string;

  @Column({ name: 'object_key', type: 'text' })
  public objectKey!: string;

  @Column({ type: 'varchar', length: 128 })
  public etag!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}

@Entity({ name: 'asset_processing_attempts' })
@Index('idx_asset_processing_attempts_workspace_status', ['workspaceId', 'status', 'createdAt'])
@Index('idx_asset_processing_attempts_asset_attempt', ['assetId', 'attemptNumber'])
export class AssetProcessingAttemptEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ name: 'asset_id', type: 'uuid' })
  public assetId!: string;

  @Column({ name: 'job_id', type: 'varchar', length: 128 })
  public jobId!: string;

  @Column({ name: 'attempt_number', type: 'integer' })
  public attemptNumber!: number;

  @Column({ type: 'varchar', length: 24 })
  public status!: AssetProcessingAttemptStatus;

  @Column({ name: 'started_at', type: 'timestamptz' })
  public startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  public completedAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  public failedAt!: Date | null;

  @Column({ name: 'failure_code', type: 'varchar', length: 80, nullable: true })
  public failureCode!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
