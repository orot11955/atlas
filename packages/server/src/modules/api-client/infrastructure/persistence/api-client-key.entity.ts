import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'api_client_keys' })
@Index('uq_api_client_keys_prefix', ['keyPrefix'], { unique: true })
@Index('uq_api_client_keys_digest', ['secretDigest'], { unique: true })
@Index('idx_api_client_keys_client_created', ['apiClientId', 'createdAt'])
export class ApiClientKeyEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'api_client_id', type: 'uuid' })
  public apiClientId!: string;

  @Column({ name: 'key_prefix', type: 'varchar', length: 64 })
  public keyPrefix!: string;

  @Column({ name: 'secret_digest', type: 'char', length: 64 })
  public secretDigest!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  public expiresAt!: Date | null;

  @Column({ name: 'grace_expires_at', type: 'timestamptz', nullable: true })
  public graceExpiresAt!: Date | null;

  @Column({ name: 'replaced_by_key_id', type: 'uuid', nullable: true })
  public replacedByKeyId!: string | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  public revokedAt!: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  public lastUsedAt!: Date | null;
}
