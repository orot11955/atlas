import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type { SiteStatus, SiteType } from '../../domain/site';

@Entity({ name: 'sites' })
@Index('uq_sites_workspace_key', ['workspaceId', 'key'], { unique: true })
@Index('idx_sites_workspace_status_created', ['workspaceId', 'status', 'createdAt'])
export class SiteEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ type: 'varchar', length: 64 })
  public key!: string;

  @Column({ type: 'varchar', length: 120 })
  public name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description!: string | null;

  @Column({ type: 'varchar', length: 24 })
  public type!: SiteType;

  @Column({ type: 'varchar', length: 24 })
  public status!: SiteStatus;

  @Column({ type: 'varchar', length: 64 })
  public timezone!: string;

  @Column({ type: 'varchar', length: 32 })
  public locale!: string;

  @Column({ type: 'integer', default: 1 })
  public version!: number;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  public archivedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
