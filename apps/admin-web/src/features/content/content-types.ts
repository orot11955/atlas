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
