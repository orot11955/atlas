import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type {
  AssetImageContentType,
  AssetKind,
  AssetStatus,
  AssetUploadSessionStatus,
} from '../../domain/asset';

const bigintNumberTransformer = {
  to: (value: number) => value,
  from: (value: string | number) => Number(value),
};

@Entity({ name: 'assets' })
@Index('idx_assets_workspace_created', ['workspaceId', 'createdAt'])
@Index('idx_assets_workspace_status_created', ['workspaceId', 'status', 'createdAt'])
export class AssetEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ type: 'varchar', length: 16 })
  public kind!: AssetKind;

  @Column({ type: 'varchar', length: 24 })
  public status!: AssetStatus;

  @Column({ name: 'original_file_name', type: 'varchar', length: 255 })
  public originalFileName!: string;

  @Column({ name: 'declared_content_type', type: 'varchar', length: 100 })
  public declaredContentType!: AssetImageContentType;

  @Column({ name: 'detected_content_type', type: 'varchar', length: 100, nullable: true })
  public detectedContentType!: AssetImageContentType | null;

  @Column({
    name: 'expected_size',
    type: 'bigint',
    transformer: bigintNumberTransformer,
  })
  public expectedSize!: number;

  @Column({
    name: 'actual_size',
    type: 'bigint',
    nullable: true,
    transformer: bigintNumberTransformer,
  })
  public actualSize!: number | null;

  @Column({ type: 'char', length: 64 })
  public sha256!: string;

  @Column({ name: 'original_object_key', type: 'text' })
  public originalObjectKey!: string;

  @Column({ name: 'original_etag', type: 'varchar', length: 128, nullable: true })
  public originalEtag!: string | null;

  @Column({ type: 'integer', nullable: true })
  public width!: number | null;

  @Column({ type: 'integer', nullable: true })
  public height!: number | null;

  @Column({ name: 'processing_failure_code', type: 'varchar', length: 80, nullable: true })
  public processingFailureCode!: string | null;

  @Column({ type: 'integer', default: 1 })
  public version!: number;

  @Column({ name: 'created_by_admin_account_id', type: 'uuid' })
  public createdByAdminAccountId!: string;

  @Column({ name: 'uploaded_at', type: 'timestamptz', nullable: true })
  public uploadedAt!: Date | null;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  public processedAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  public failedAt!: Date | null;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  public archivedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}

@Entity({ name: 'asset_upload_sessions' })
@Index('idx_asset_upload_sessions_workspace_expires', ['workspaceId', 'status', 'expiresAt'])
export class AssetUploadSessionEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ name: 'asset_id', type: 'uuid' })
  public assetId!: string;

  @Column({ type: 'varchar', length: 24 })
  public status!: AssetUploadSessionStatus;

  @Column({ name: 'temporary_object_key', type: 'text' })
  public temporaryObjectKey!: string;

  @Column({
    name: 'expected_size',
    type: 'bigint',
    transformer: bigintNumberTransformer,
  })
  public expectedSize!: number;

  @Column({ name: 'expected_sha256', type: 'char', length: 64 })
  public expectedSha256!: string;

  @Column({ name: 'declared_content_type', type: 'varchar', length: 100 })
  public declaredContentType!: AssetImageContentType;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  public expiresAt!: Date;

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
