import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type { AdminAccountStatus } from '../../domain/admin-account-status';
import type { AdminRole } from '../../domain/admin-role';

@Entity({ name: 'admin_accounts' })
@Index('uq_admin_accounts_email', ['email'], { unique: true })
@Index('idx_admin_accounts_role_status', ['role', 'status'])
export class AdminAccountEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ type: 'varchar', length: 320 })
  public email!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 120 })
  public displayName!: string;

  @Column({ name: 'password_hash', type: 'text' })
  public passwordHash!: string;

  @Column({ type: 'varchar', length: 32 })
  public role!: AdminRole;

  @Column({ type: 'varchar', length: 32 })
  public status!: AdminAccountStatus;

  @Column({ name: 'failed_login_count', type: 'integer', default: 0 })
  public failedLoginCount!: number;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  public lockedUntil!: Date | null;

  @Column({ name: 'password_changed_at', type: 'timestamptz' })
  public passwordChangedAt!: Date;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  public lastLoginAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
