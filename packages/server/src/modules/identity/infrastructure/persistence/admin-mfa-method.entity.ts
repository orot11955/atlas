import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  type ValueTransformer,
} from 'typeorm';

import type {
  AdminMfaAlgorithm,
  AdminMfaMethodStatus,
  AdminMfaMethodType,
} from '../../domain/admin-mfa';

const nullableBigIntTransformer: ValueTransformer = {
  to(value: number | null | undefined): string | null {
    return value === null || value === undefined ? null : String(value);
  },
  from(value: string | null): number | null {
    return value === null ? null : Number(value);
  },
};

@Entity({ name: 'admin_mfa_methods' })
@Index('uq_admin_mfa_methods_account_type', ['adminAccountId', 'methodType'], {
  unique: true,
})
@Index('idx_admin_mfa_methods_account_status', ['adminAccountId', 'status'])
export class AdminMfaMethodEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'admin_account_id', type: 'uuid' })
  public adminAccountId!: string;

  @Column({ name: 'method_type', type: 'varchar', length: 16 })
  public methodType!: AdminMfaMethodType;

  @Column({ type: 'varchar', length: 16 })
  public status!: AdminMfaMethodStatus;

  @Column({ name: 'encrypted_secret', type: 'text' })
  public encryptedSecret!: string;

  @Column({ name: 'secret_key_version', type: 'varchar', length: 64 })
  public secretKeyVersion!: string;

  @Column({ type: 'varchar', length: 16 })
  public algorithm!: AdminMfaAlgorithm;

  @Column({ type: 'smallint' })
  public digits!: number;

  @Column({ name: 'period_seconds', type: 'smallint' })
  public periodSeconds!: number;

  @Column({
    name: 'last_used_step',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigIntTransformer,
  })
  public lastUsedStep!: number | null;

  @Column({ name: 'enrolled_at', type: 'timestamptz' })
  public enrolledAt!: Date;

  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  public activatedAt!: Date | null;

  @Column({ name: 'disabled_at', type: 'timestamptz', nullable: true })
  public disabledAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
