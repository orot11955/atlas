import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type { AdminRole } from '../../domain/admin-role';
import type { AdminSessionRevokeReason } from '../../domain/admin-session';

@Entity({ name: 'admin_sessions' })
@Index('uq_admin_sessions_token_digest', ['tokenDigest'], { unique: true })
@Index('uq_admin_sessions_source_grant', ['sourceGrantId'], { unique: true })
@Index('idx_admin_sessions_account_created_at', ['adminAccountId', 'createdAt'])
@Index('idx_admin_sessions_account_active', [
  'adminAccountId',
  'revokedAt',
  'idleExpiresAt',
  'absoluteExpiresAt',
])
export class AdminSessionEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'admin_account_id', type: 'uuid' })
  public adminAccountId!: string;

  @Column({ name: 'source_grant_id', type: 'uuid' })
  public sourceGrantId!: string;

  @Column({ name: 'token_digest', type: 'char', length: 64 })
  public tokenDigest!: string;

  @Column({ name: 'csrf_token_digest', type: 'char', length: 64 })
  public csrfTokenDigest!: string;

  @Column({ name: 'client_fingerprint', type: 'char', length: 64 })
  public clientFingerprint!: string;

  @Column({ type: 'varchar', length: 32 })
  public role!: AdminRole;

  @Column({ name: 'password_changed_at', type: 'timestamptz' })
  public passwordChangedAt!: Date;

  @Column({ name: 'user_agent_summary', type: 'varchar', length: 255 })
  public userAgentSummary!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  public lastSeenAt!: Date;

  @Column({ name: 'idle_expires_at', type: 'timestamptz' })
  public idleExpiresAt!: Date;

  @Column({ name: 'absolute_expires_at', type: 'timestamptz' })
  public absoluteExpiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  public revokedAt!: Date | null;

  @Column({ name: 'revoke_reason', type: 'varchar', length: 48, nullable: true })
  public revokeReason!: AdminSessionRevokeReason | null;
}
