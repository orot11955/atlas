import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type { ContentPublicationAssetSnapshot } from '../../domain/content-asset';
import type { ContentType } from '../../domain/content';
import type {
  ContentPublicationStatus,
  ContentSiteVisibility,
} from '../../domain/content-publication';

@Entity({ name: 'content_sites' })
@Index('uq_content_sites_content_site', ['workspaceId', 'contentId', 'siteId'], { unique: true })
@Index('uq_content_sites_site_slug', ['workspaceId', 'siteId', 'slug'], { unique: true })
@Index('idx_content_sites_workspace_content', ['workspaceId', 'contentId', 'createdAt'])
export class ContentSiteEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ name: 'content_id', type: 'uuid' })
  public contentId!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  public siteId!: string;

  @Column({ type: 'varchar', length: 160 })
  public slug!: string;

  @Column({ name: 'title_override', type: 'varchar', length: 200, nullable: true })
  public titleOverride!: string | null;

  @Column({ name: 'summary_override', type: 'varchar', length: 500, nullable: true })
  public summaryOverride!: string | null;

  @Column({ name: 'seo_json', type: 'jsonb', default: () => "'{}'::jsonb" })
  public seoJson!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 16 })
  public visibility!: ContentSiteVisibility;

  @Column({ type: 'integer', default: 1 })
  public version!: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}

@Entity({ name: 'content_publications' })
@Index('uq_content_publications_active_content_site', ['workspaceId', 'contentSiteId'], {
  unique: true,
  where: "status = 'active'",
})
@Index('uq_content_publications_active_site_slug', ['workspaceId', 'siteId', 'slug'], {
  unique: true,
  where: "status = 'active'",
})
@Index('idx_content_publications_history', ['workspaceId', 'contentSiteId', 'publishedAt'])
@Index('idx_content_publications_delivery', [
  'workspaceId',
  'siteId',
  'status',
  'visibility',
  'publishedAt',
])
export class ContentPublicationEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ name: 'content_site_id', type: 'uuid' })
  public contentSiteId!: string;

  @Column({ name: 'content_id', type: 'uuid' })
  public contentId!: string;

  @Column({ name: 'content_type', type: 'varchar', length: 24 })
  public contentType!: ContentType;

  @Column({ name: 'site_id', type: 'uuid' })
  public siteId!: string;

  @Column({ name: 'site_key', type: 'varchar', length: 64 })
  public siteKey!: string;

  @Column({ name: 'site_name', type: 'varchar', length: 120 })
  public siteName!: string;

  @Column({ name: 'revision_id', type: 'uuid' })
  public revisionId!: string;

  @Column({ name: 'revision_number', type: 'integer' })
  public revisionNumber!: number;

  @Column({ type: 'varchar', length: 16 })
  public status!: ContentPublicationStatus;

  @Column({ type: 'varchar', length: 160 })
  public slug!: string;

  @Column({ type: 'varchar', length: 200 })
  public title!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public summary!: string | null;

  @Column({ name: 'body_html', type: 'text' })
  public bodyHtml!: string;

  @Column({ name: 'asset_manifest_json', type: 'jsonb', default: () => "'[]'::jsonb" })
  public assetManifestJson!: ContentPublicationAssetSnapshot[];

  @Column({ name: 'seo_json', type: 'jsonb', default: () => "'{}'::jsonb" })
  public seoJson!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 16 })
  public visibility!: ContentSiteVisibility;

  @Column({ type: 'char', length: 64 })
  public etag!: string;

  @Column({ name: 'published_at', type: 'timestamptz' })
  public publishedAt!: Date;

  @Column({ name: 'superseded_at', type: 'timestamptz', nullable: true })
  public supersededAt!: Date | null;

  @Column({ name: 'withdrawn_at', type: 'timestamptz', nullable: true })
  public withdrawnAt!: Date | null;

  @Column({ name: 'created_by_admin_account_id', type: 'uuid' })
  public createdByAdminAccountId!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}
