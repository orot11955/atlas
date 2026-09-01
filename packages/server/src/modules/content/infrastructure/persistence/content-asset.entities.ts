import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type { AssetUsageKind } from '../../domain/content-asset';

@Entity({ name: 'asset_usages' })
@Index('idx_asset_usages_workspace_asset', ['workspaceId', 'assetId', 'createdAt'])
@Index('idx_asset_usages_workspace_revision', ['workspaceId', 'revisionId', 'ordinal'])
export class AssetUsageEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ name: 'asset_id', type: 'uuid' })
  public assetId!: string;

  @Column({ name: 'revision_id', type: 'uuid' })
  public revisionId!: string;

  @Column({ type: 'integer' })
  public ordinal!: number;

  @Column({ name: 'usage_kind', type: 'varchar', length: 24 })
  public kind!: AssetUsageKind;

  @Column({ name: 'alt_text', type: 'varchar', length: 300 })
  public altText!: string;

  @Column({ type: 'varchar', length: 1_000, nullable: true })
  public caption!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}
