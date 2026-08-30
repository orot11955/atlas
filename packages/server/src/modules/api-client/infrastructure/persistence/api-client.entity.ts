import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type {
  ApiClientStatus,
  ApiClientType,
} from '../../domain/api-client';

@Entity({ name: 'api_clients' })
@Index('uq_api_clients_id_workspace', ['id', 'workspaceId'], { unique: true })
@Index('idx_api_clients_workspace_status_created', [
  'workspaceId',
  'status',
  'createdAt',
])
export class ApiClientEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ type: 'varchar', length: 120 })
  public name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description!: string | null;

  @Column({ type: 'varchar', length: 24 })
  public type!: ApiClientType;

  @Column({ type: 'varchar', length: 24 })
  public status!: ApiClientStatus;

  @Column({ name: 'rate_limit_per_minute', type: 'integer' })
  public rateLimitPerMinute!: number;

  @Column({ name: 'require_origin', type: 'boolean', default: false })
  public requireOrigin!: boolean;

  @Column({ type: 'integer', default: 1 })
  public version!: number;

  @Column({ name: 'disabled_at', type: 'timestamptz', nullable: true })
  public disabledAt!: Date | null;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  public archivedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
