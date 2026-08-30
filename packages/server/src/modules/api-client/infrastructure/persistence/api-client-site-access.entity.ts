import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'api_client_site_access' })
@Index('idx_api_client_site_access_workspace_site', ['workspaceId', 'siteId'])
export class ApiClientSiteAccessEntity {
  @PrimaryColumn({ name: 'api_client_id', type: 'uuid' })
  public apiClientId!: string;

  @PrimaryColumn({ name: 'site_id', type: 'uuid' })
  public siteId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}
