import type {
  ContentCoverAsset,
  ContentDraftRecord,
  ContentRecord,
  ContentRevisionKind,
  ContentRevisionRecord,
  ContentStatus,
  ContentType,
} from '../domain/content';

export interface ContentListCursor {
  updatedAt: Date;
  id: string;
}

export interface ContentListQuery {
  limit: number;
  cursor?: ContentListCursor;
  status?: ContentStatus;
  type?: ContentType;
  search?: string;
}

export interface InsertContentInput {
  content: Omit<ContentRecord, 'draft'>;
  draft: ContentDraftRecord;
}

export interface UpdateContentDraftInput {
  title: string;
  summary?: string;
  bodyMarkdown: string;
  cover?: ContentCoverAsset;
  expectedDraftVersion: number;
  nextDraftVersion: number;
  updatedByAdminAccountId: string;
  updatedAt: Date;
}

export interface InsertContentRevisionInput {
  revision: ContentRevisionRecord;
  expectedContentVersion: number;
  nextContentVersion: number;
  status: ContentStatus;
  currentRevisionNumber: number;
  readyRevisionNumber?: number;
  updatedAt: Date;
}

export interface RestoreContentDraftInput {
  title: string;
  summary?: string;
  bodyMarkdown: string;
  cover?: ContentCoverAsset;
  expectedDraftVersion: number;
  nextDraftVersion: number;
  updatedByAdminAccountId: string;
  updatedAt: Date;
}

export interface ArchiveContentInput {
  expectedContentVersion: number;
  nextContentVersion: number;
  archivedAt: Date;
}

export interface ContentRepositoryPort<TTransaction = unknown> {
  list(workspaceId: string, query: ContentListQuery): Promise<readonly ContentRecord[]>;
  findById(
    workspaceId: string,
    contentId: string,
    transaction?: TTransaction,
  ): Promise<ContentRecord | undefined>;
  insert(input: InsertContentInput, transaction: TTransaction): Promise<void>;
  updateDraft(
    workspaceId: string,
    contentId: string,
    input: UpdateContentDraftInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  insertRevision(
    workspaceId: string,
    contentId: string,
    input: InsertContentRevisionInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  listRevisions(workspaceId: string, contentId: string): Promise<readonly ContentRevisionRecord[]>;
  findRevision(
    workspaceId: string,
    contentId: string,
    revisionId: string,
    transaction?: TTransaction,
  ): Promise<ContentRevisionRecord | undefined>;
  restoreDraft(
    workspaceId: string,
    contentId: string,
    input: RestoreContentDraftInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  archive(
    workspaceId: string,
    contentId: string,
    input: ArchiveContentInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  countRevisionKind(
    workspaceId: string,
    contentId: string,
    kind: ContentRevisionKind,
  ): Promise<number>;
}
