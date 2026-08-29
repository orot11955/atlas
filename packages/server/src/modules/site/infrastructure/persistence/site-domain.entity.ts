import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type { SiteDomainVerificationStatus } from '../../domain/site';

@Entity({ name: 'site_domains' })
@Index('uq_site_domains_workspace_hostname', ['workspaceId', 'hostname'], {
  unique: true,
})
@Index('idx_site_domains_site_kind', ['siteId', 'kind'])
export class SiteDomainEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  public siteId!: string;

  @Column({ type: 'varchar', length: 253 })
  public hostname!: string;

  @Column({ type: 'varchar', length: 16 })
  public kind!: 'canonical' | 'alias';

  @Column({ name: 'verification_status', type: 'varchar', length: 16 })
  public verificationStatus!: SiteDomainVerificationStatus;

  @Column({ name: 'verification_token_digest', type: 'char', length: 64, nullable: true })
  public verificationTokenDigest!: string | null;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  public verifiedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
