import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'site_settings' })
export class SiteSettingsEntity {
  @PrimaryColumn({ name: 'site_id', type: 'uuid' })
  public siteId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ name: 'branding_json', type: 'jsonb', default: () => "'{}'::jsonb" })
  public brandingJson!: Record<string, unknown>;

  @Column({ name: 'seo_defaults_json', type: 'jsonb', default: () => "'{}'::jsonb" })
  public seoDefaultsJson!: Record<string, unknown>;

  @Column({ type: 'integer', default: 1 })
  public version!: number;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
