import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type { ContentRevisionKind, ContentStatus, ContentType } from '../../domain/content';

@Entity({ name: 'contents' })
@Index('idx_contents_workspace_status_updated', ['workspaceId', 'status', 'updatedAt'])
export class ContentEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ type: 'varchar', length: 24 })
  public type!: ContentType;

  @Column({ type: 'varchar', length: 24 })
  public status!: ContentStatus;

  @Column({ type: 'integer', default: 1 })
  public version!: number;

  @Column({ name: 'current_revision_number', type: 'integer', nullable: true })
  public currentRevisionNumber!: number | null;

  @Column({ name: 'ready_revision_number', type: 'integer', nullable: true })
  public readyRevisionNumber!: number | null;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  public archivedAt!: Date | null;

  @Column({ name: 'created_by_admin_account_id', type: 'uuid' })
  public createdByAdminAccountId!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}

@Entity({ name: 'content_drafts' })
@Index('idx_content_drafts_workspace_updated', ['workspaceId', 'updatedAt'])
export class ContentDraftEntity {
  @PrimaryColumn({ name: 'content_id', type: 'uuid' })
  public contentId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ type: 'varchar', length: 200 })
  public title!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public summary!: string | null;

  @Column({ name: 'body_markdown', type: 'text' })
  public bodyMarkdown!: string;

  @Column({ name: 'cover_asset_id', type: 'uuid', nullable: true })
  public coverAssetId!: string | null;

  @Column({ name: 'cover_alt_text', type: 'varchar', length: 300, nullable: true })
  public coverAltText!: string | null;

  @Column({ name: 'cover_caption', type: 'varchar', length: 1_000, nullable: true })
  public coverCaption!: string | null;

  @Column({ name: 'draft_version', type: 'integer', default: 1 })
  public draftVersion!: number;

  @Column({ name: 'updated_by_admin_account_id', type: 'uuid' })
  public updatedByAdminAccountId!: string;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}

@Entity({ name: 'content_revisions' })
@Index('uq_content_revisions_number', ['contentId', 'revisionNumber'], {
  unique: true,
})
@Index('idx_content_revisions_workspace_content_created', ['workspaceId', 'contentId', 'createdAt'])
export class ContentRevisionEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'content_id', type: 'uuid' })
  public contentId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ name: 'revision_number', type: 'integer' })
  public revisionNumber!: number;

  @Column({ type: 'varchar', length: 24 })
  public kind!: ContentRevisionKind;

  @Column({ type: 'varchar', length: 200 })
  public title!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public summary!: string | null;

  @Column({ name: 'body_markdown', type: 'text' })
  public bodyMarkdown!: string;

  @Column({ name: 'body_html', type: 'text' })
  public bodyHtml!: string;

  @Column({ name: 'cover_asset_id', type: 'uuid', nullable: true })
  public coverAssetId!: string | null;

  @Column({ name: 'cover_alt_text', type: 'varchar', length: 300, nullable: true })
  public coverAltText!: string | null;

  @Column({ name: 'cover_caption', type: 'varchar', length: 1_000, nullable: true })
  public coverCaption!: string | null;

  @Column({ name: 'source_draft_version', type: 'integer' })
  public sourceDraftVersion!: number;

  @Column({ type: 'varchar', length: 300, nullable: true })
  public note!: string | null;

  @Column({ name: 'created_by_admin_account_id', type: 'uuid' })
  public createdByAdminAccountId!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}
