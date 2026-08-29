import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'admin_recovery_codes' })
@Index('uq_admin_recovery_codes_digest', ['codeDigest'], { unique: true })
@Index('idx_admin_recovery_codes_account_created_at', ['adminAccountId', 'createdAt'])
export class AdminRecoveryCodeEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'admin_account_id', type: 'uuid' })
  public adminAccountId!: string;

  @Column({ name: 'code_digest', type: 'char', length: 64 })
  public codeDigest!: string;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  public usedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}
