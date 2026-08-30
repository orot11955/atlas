export type ContentType = 'post' | 'page' | 'document';
export type ContentStatus = 'draft' | 'ready' | 'archived';
export type ContentRevisionKind = 'checkpoint' | 'ready';

export interface ContentDraft {
  title: string;
  summary: string | null;
  bodyMarkdown: string;
  draftVersion: number;
  updatedByAdminAccountId: string;
  updatedAt: string;
}

export interface Content {
  id: string;
  workspaceId: string;
  type: ContentType;
  status: ContentStatus;
  version: number;
  currentRevisionNumber: number | null;
  readyRevisionNumber: number | null;
  archivedAt: string | null;
  createdByAdminAccountId: string;
  createdAt: string;
  updatedAt: string;
  draft: ContentDraft;
}

export interface ContentRevision {
  id: string;
  contentId: string;
  revisionNumber: number;
  kind: ContentRevisionKind;
  title: string;
  summary: string | null;
  bodyMarkdown: string;
  bodyHtml: string;
  sourceDraftVersion: number;
  note: string | null;
  createdByAdminAccountId: string;
  createdAt: string;
}

export interface ContentListResult {
  items: readonly Content[];
  pageInfo: { nextCursor?: string };
}

export interface ApiEnvelope<T> {
  data: T;
}

export const CONTENT_TYPE_OPTIONS: readonly Readonly<{
  value: ContentType;
  label: string;
}>[] = Object.freeze([
  { value: 'post', label: 'Post' },
  { value: 'page', label: 'Page' },
  { value: 'document', label: 'Document' },
]);

export const CONTENT_STATUS_OPTIONS: readonly Readonly<{
  value: ContentStatus;
  label: string;
}>[] = Object.freeze([
  { value: 'draft', label: 'Draft' },
  { value: 'ready', label: 'Ready' },
  { value: 'archived', label: 'Archived' },
]);

export type ContentSiteVisibility = 'public' | 'unlisted' | 'private';
export type ContentPublicationStatus = 'active' | 'superseded' | 'withdrawn';

export interface ContentSiteActivePublication {
  id: string;
  revisionId: string;
  revisionNumber: number;
  status: ContentPublicationStatus;
  etag: string;
  publishedAt: string;
}

export interface ContentSiteAssignment {
  id: string;
  contentId: string;
  site: {
    id: string;
    key: string;
    name: string;
    status: string;
  };
  slug: string;
  titleOverride: string | null;
  summaryOverride: string | null;
  seo: Record<string, unknown>;
  visibility: ContentSiteVisibility;
  version: number;
  activePublication: ContentSiteActivePublication | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentPublication {
  id: string;
  contentSiteId: string;
  contentId: string;
  contentType: ContentType;
  site: {
    id: string;
    key: string;
    name: string;
  };
  revisionId: string;
  revisionNumber: number;
  status: ContentPublicationStatus;
  slug: string;
  title: string;
  summary: string | null;
  bodyHtml: string;
  seo: Record<string, unknown>;
  visibility: ContentSiteVisibility;
  etag: string;
  publishedAt: string;
  supersededAt: string | null;
  withdrawnAt: string | null;
  createdByAdminAccountId: string;
  createdAt: string;
}

export const CONTENT_SITE_VISIBILITY_OPTIONS: readonly Readonly<{
  value: ContentSiteVisibility;
  label: string;
}>[] = Object.freeze([
  { value: 'public', label: 'Public' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'private', label: 'Private' },
]);
