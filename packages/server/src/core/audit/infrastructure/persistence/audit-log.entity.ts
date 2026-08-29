import { Column, Entity, PrimaryColumn } from 'typeorm';

import type { ActorType } from '../../../request-context';
import type { AuditResult } from '../../audit-result';

@Entity({ name: 'audit_logs' })
export class AuditLogEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  public workspaceId!: string | null;

  @Column({ name: 'site_id', type: 'uuid', nullable: true })
  public siteId!: string | null;

  @Column({ name: 'actor_type', type: 'varchar', length: 32 })
  public actorType!: ActorType;

  @Column({ name: 'actor_id', type: 'varchar', length: 128, nullable: true })
  public actorId!: string | null;

  @Column({ type: 'varchar', length: 128 })
  public action!: string;

  @Column({ name: 'target_type', type: 'varchar', length: 128 })
  public targetType!: string;

  @Column({ name: 'target_id', type: 'varchar', length: 128, nullable: true })
  public targetId!: string | null;

  @Column({ name: 'request_id', type: 'varchar', length: 128 })
  public requestId!: string;

  @Column({ name: 'trace_id', type: 'varchar', length: 128 })
  public traceId!: string;

  @Column({ name: 'correlation_id', type: 'varchar', length: 128, nullable: true })
  public correlationId!: string | null;

  @Column({ type: 'varchar', length: 16 })
  public result!: AuditResult;

  @Column({ name: 'error_code', type: 'varchar', length: 64, nullable: true })
  public errorCode!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  public metadata!: object;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  public occurredAt!: Date;
}
