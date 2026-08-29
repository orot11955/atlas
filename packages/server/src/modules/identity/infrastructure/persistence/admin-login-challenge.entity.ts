import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'admin_login_challenges' })
@Index('uq_admin_login_challenges_token_digest', ['tokenDigest'], { unique: true })
@Index('idx_admin_login_challenges_account_expires_at', ['adminAccountId', 'expiresAt'])
export class AdminLoginChallengeEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'admin_account_id', type: 'uuid' })
  public adminAccountId!: string;

  @Column({ name: 'token_digest', type: 'char', length: 64 })
  public tokenDigest!: string;

  @Column({ name: 'ip_fingerprint', type: 'char', length: 64 })
  public ipFingerprint!: string;

  @Column({ name: 'request_id', type: 'varchar', length: 128 })
  public requestId!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  public expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  public consumedAt!: Date | null;

  @Column({ name: 'invalidated_at', type: 'timestamptz', nullable: true })
  public invalidatedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}
