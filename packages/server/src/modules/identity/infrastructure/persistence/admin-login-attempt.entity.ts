import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type { AdminLoginAttemptOutcome } from '../../domain/admin-login';

@Entity({ name: 'admin_login_attempts' })
@Index('idx_admin_login_attempts_account_occurred_at', ['adminAccountId', 'occurredAt'])
@Index('idx_admin_login_attempts_email_occurred_at', ['emailFingerprint', 'occurredAt'])
@Index('idx_admin_login_attempts_ip_occurred_at', ['ipFingerprint', 'occurredAt'])
export class AdminLoginAttemptEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'admin_account_id', type: 'uuid', nullable: true })
  public adminAccountId!: string | null;

  @Column({ name: 'email_fingerprint', type: 'char', length: 64 })
  public emailFingerprint!: string;

  @Column({ name: 'ip_fingerprint', type: 'char', length: 64 })
  public ipFingerprint!: string;

  @Column({ type: 'varchar', length: 32 })
  public outcome!: AdminLoginAttemptOutcome;

  @Column({ name: 'request_id', type: 'varchar', length: 128 })
  public requestId!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  public occurredAt!: Date;
}
