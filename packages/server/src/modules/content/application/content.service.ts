import type { AuditService, Clock, TransactionRunner } from '../../../core';
import {
  AuditResult,
  DomainError,
  ErrorCode,
  createUuidV7,
  requestContext,
  systemClock,
} from '../../../core';
import {
  ContentRevisionKind,
  ContentStatus,
  assertContentEditable,
  normalizeContentMarkdown,
  normalizeContentSummary,
  normalizeContentTitle,
  normalizeContentType,
  normalizeRevisionNote,
  renderMarkdownPreview,
  validateReadyDraft,
  type ContentDraftSnapshot,
  type ContentRecord,
  type ContentRevisionRecord,
  type ContentStatus as ContentStatusType,
  type ContentType,
  type MarkdownPreview,
} from '../domain/content';
import type {
  ContentListCursor,
  ContentRepositoryPort,
} from '../ports/content.repository';

export interface ContentListServiceQuery {
  limit?: number;
  cursor?: string;
  status?: ContentStatusType;
  type?: ContentType;
  search?: string;
}

export interface ContentListServiceResult {
  items: readonly Readonly<ContentRecord>[];
  nextCursor?: string;
}

export interface CreateContentInput extends ContentDraftSnapshot {
  type: ContentType;
}

export interface SaveContentDraftInput extends ContentDraftSnapshot {
  draftVersion: number;
}

export interface CreateRevisionInput {
  contentVersion: number;
  draftVersion: number;
  note?: string;
}

export interface RestoreRevisionInput {
  draftVersion: number;
}

export class ContentService<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: ContentRepositoryPort<TTransaction>,
    private readonly auditService: AuditService<TTransaction>,
    private readonly clock: Clock = systemClock,
  ) {}

  public async listContents(
    workspaceId: string,
    query: ContentListServiceQuery = {},
  ): Promise<Readonly<ContentListServiceResult>> {
    const limit = normalizeLimit(query.limit);
    const records = await this.repository.list(workspaceId, {
      limit: limit + 1,
      cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
      status: query.status,
      type: query.type,
      search: normalizeSearch(query.search),
    });
    const hasNext = records.length > limit;
    const items = records.slice(0, limit).map((record) => freezeContent(record));
    const last = items.at(-1);

    return Object.freeze({
      items: Object.freeze(items),
      ...(hasNext && last
        ? { nextCursor: encodeCursor({ updatedAt: last.updatedAt, id: last.id }) }
        : {}),
    });
  }

  public async getContent(
    workspaceId: string,
    contentId: string,
  ): Promise<Readonly<ContentRecord>> {
    const content = await this.repository.findById(workspaceId, contentId);

    if (!content) {
      throw contentNotFoundError();
    }

    return freezeContent(content);
  }

  public async createContent(
    workspaceId: string,
    input: CreateContentInput,
  ): Promise<Readonly<ContentRecord>> {
    const actorId = requireAdminActorId();
    const now = this.clock.now();
    const id = createUuidV7(now.getTime());
    const type = normalizeContentType(input.type);
    const title = normalizeContentTitle(input.title);
    const summary = normalizeContentSummary(input.summary);
    const bodyMarkdown = normalizeContentMarkdown(input.bodyMarkdown);
    const content: ContentRecord = {
      id,
      workspaceId,
      type,
      status: ContentStatus.DRAFT,
      version: 1,
      createdByAdminAccountId: actorId,
      createdAt: now,
      updatedAt: now,
      draft: {
        contentId: id,
        workspaceId,
        title,
        summary,
        bodyMarkdown,
        draftVersion: 1,
        updatedByAdminAccountId: actorId,
        updatedAt: now,
      },
    };

    await this.transactionRunner.run(async (transaction) => {
      await this.repository.insert(
        { content: { ...content, draft: undefined } as never, draft: content.draft },
        transaction,
      );
      await this.auditService.record(
        {
          action: 'content.created',
          targetType: 'content',
          targetId: id,
          result: AuditResult.SUCCESS,
          metadata: { type, status: ContentStatus.DRAFT },
        },
        transaction,
      );
    });

    return freezeContent(content);
  }

  public async saveDraft(
    workspaceId: string,
    contentId: string,
    input: SaveContentDraftInput,
  ): Promise<Readonly<ContentRecord>> {
    assertPositiveVersion(input.draftVersion, 'draftVersion');
    const actorId = requireAdminActorId();
    const title = normalizeContentTitle(input.title);
    const summary = normalizeContentSummary(input.summary);
    const bodyMarkdown = normalizeContentMarkdown(input.bodyMarkdown);
    const updatedAt = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findById(
        workspaceId,
        contentId,
        transaction,
      );

      if (!current) {
        throw contentNotFoundError();
      }

      assertContentEditable(current.status);
      const updated = await this.repository.updateDraft(
        workspaceId,
        contentId,
        {
          title,
          summary,
          bodyMarkdown,
          expectedDraftVersion: input.draftVersion,
          nextDraftVersion: input.draftVersion + 1,
          updatedByAdminAccountId: actorId,
          updatedAt,
        },
        transaction,
      );

      if (!updated) {
        throw versionConflictError('Content Draft was changed by another request.');
      }

      return freezeContent({
        ...current,
        updatedAt,
        draft: {
          ...current.draft,
          title,
          summary,
          bodyMarkdown,
          draftVersion: input.draftVersion + 1,
          updatedByAdminAccountId: actorId,
          updatedAt,
        },
      });
    });
  }

  public preview(input: ContentDraftSnapshot): Readonly<MarkdownPreview> {
    normalizeContentTitle(input.title);
    normalizeContentSummary(input.summary);
    return renderMarkdownPreview(input.bodyMarkdown);
  }

  public createCheckpoint(
    workspaceId: string,
    contentId: string,
    input: CreateRevisionInput,
  ): Promise<Readonly<ContentRecord>> {
    return this.createRevision(
      workspaceId,
      contentId,
      input,
      ContentRevisionKind.CHECKPOINT,
    );
  }

  public createReadyRevision(
    workspaceId: string,
    contentId: string,
    input: CreateRevisionInput,
  ): Promise<Readonly<ContentRecord>> {
    return this.createRevision(
      workspaceId,
      contentId,
      input,
      ContentRevisionKind.READY,
    );
  }

  public async listRevisions(
    workspaceId: string,
    contentId: string,
  ): Promise<readonly Readonly<ContentRevisionRecord>[]> {
    const content = await this.repository.findById(workspaceId, contentId);

    if (!content) {
      throw contentNotFoundError();
    }

    const revisions = await this.repository.listRevisions(workspaceId, contentId);
    return Object.freeze(revisions.map(freezeRevision));
  }

  public async restoreRevision(
    workspaceId: string,
    contentId: string,
    revisionId: string,
    input: RestoreRevisionInput,
  ): Promise<Readonly<ContentRecord>> {
    assertPositiveVersion(input.draftVersion, 'draftVersion');
    const actorId = requireAdminActorId();
    const updatedAt = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const [content, revision] = await Promise.all([
        this.repository.findById(workspaceId, contentId, transaction),
        this.repository.findRevision(
          workspaceId,
          contentId,
          revisionId,
          transaction,
        ),
      ]);

      if (!content) {
        throw contentNotFoundError();
      }

      if (!revision) {
        throw new DomainError({
          code: ErrorCode.NOT_FOUND,
          message: 'Content Revision was not found.',
        });
      }

      assertContentEditable(content.status);
      const restored = await this.repository.restoreDraft(
        workspaceId,
        contentId,
        {
          title: revision.title,
          summary: revision.summary,
          bodyMarkdown: revision.bodyMarkdown,
          expectedDraftVersion: input.draftVersion,
          nextDraftVersion: input.draftVersion + 1,
          updatedByAdminAccountId: actorId,
          updatedAt,
        },
        transaction,
      );

      if (!restored) {
        throw versionConflictError('Content Draft was changed by another request.');
      }

      await this.auditService.record(
        {
          action: 'content.revision-restored',
          targetType: 'content',
          targetId: contentId,
          result: AuditResult.SUCCESS,
          metadata: {
            revisionId,
            revisionNumber: revision.revisionNumber,
            draftVersion: input.draftVersion + 1,
          },
        },
        transaction,
      );

      return freezeContent({
        ...content,
        updatedAt,
        draft: {
          ...content.draft,
          title: revision.title,
          summary: revision.summary,
          bodyMarkdown: revision.bodyMarkdown,
          draftVersion: input.draftVersion + 1,
          updatedByAdminAccountId: actorId,
          updatedAt,
        },
      });
    });
  }

  public async archiveContent(
    workspaceId: string,
    contentId: string,
    contentVersion: number,
  ): Promise<Readonly<ContentRecord>> {
    assertPositiveVersion(contentVersion, 'contentVersion');
    const archivedAt = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const content = await this.repository.findById(
        workspaceId,
        contentId,
        transaction,
      );

      if (!content) {
        throw contentNotFoundError();
      }

      assertContentEditable(content.status);
      const archived = await this.repository.archive(
        workspaceId,
        contentId,
        {
          expectedContentVersion: contentVersion,
          nextContentVersion: contentVersion + 1,
          archivedAt,
        },
        transaction,
      );

      if (!archived) {
        throw versionConflictError('Content was changed by another request.');
      }

      await this.auditService.record(
        {
          action: 'content.archived',
          targetType: 'content',
          targetId: contentId,
          result: AuditResult.SUCCESS,
          metadata: { version: contentVersion + 1 },
        },
        transaction,
      );

      return freezeContent({
        ...content,
        status: ContentStatus.ARCHIVED,
        version: contentVersion + 1,
        archivedAt,
        updatedAt: archivedAt,
      });
    });
  }

  private async createRevision(
    workspaceId: string,
    contentId: string,
    input: CreateRevisionInput,
    kind: ContentRevisionKind,
  ): Promise<Readonly<ContentRecord>> {
    assertPositiveVersion(input.contentVersion, 'contentVersion');
    assertPositiveVersion(input.draftVersion, 'draftVersion');
    const actorId = requireAdminActorId();
    const note = normalizeRevisionNote(input.note);
    const createdAt = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const content = await this.repository.findById(
        workspaceId,
        contentId,
        transaction,
      );

      if (!content) {
        throw contentNotFoundError();
      }

      assertContentEditable(content.status);

      if (content.version !== input.contentVersion) {
        throw versionConflictError('Content was changed by another request.');
      }

      if (content.draft.draftVersion !== input.draftVersion) {
        throw versionConflictError('Content Draft was changed by another request.');
      }

      if (kind === ContentRevisionKind.READY) {
        validateReadyDraft(content.draft);
      }

      const preview = renderMarkdownPreview(content.draft.bodyMarkdown);
      const revisionNumber = (content.currentRevisionNumber ?? 0) + 1;
      const revision: ContentRevisionRecord = {
        id: createUuidV7(createdAt.getTime()),
        contentId,
        workspaceId,
        revisionNumber,
        kind,
        title: content.draft.title,
        summary: content.draft.summary,
        bodyMarkdown: content.draft.bodyMarkdown,
        bodyHtml: preview.html,
        sourceDraftVersion: content.draft.draftVersion,
        note,
        createdByAdminAccountId: actorId,
        createdAt,
      };
      const nextStatus =
        kind === ContentRevisionKind.READY
          ? ContentStatus.READY
          : content.status;
      const readyRevisionNumber =
        kind === ContentRevisionKind.READY
          ? revisionNumber
          : content.readyRevisionNumber;
      const inserted = await this.repository.insertRevision(
        workspaceId,
        contentId,
        {
          revision,
          expectedContentVersion: input.contentVersion,
          nextContentVersion: input.contentVersion + 1,
          status: nextStatus,
          currentRevisionNumber: revisionNumber,
          readyRevisionNumber,
          updatedAt: createdAt,
        },
        transaction,
      );

      if (!inserted) {
        throw versionConflictError('Content was changed by another request.');
      }

      await this.auditService.record(
        {
          action:
            kind === ContentRevisionKind.READY
              ? 'content.ready-revision-created'
              : 'content.checkpoint-created',
          targetType: 'content',
          targetId: contentId,
          result: AuditResult.SUCCESS,
          metadata: {
            revisionId: revision.id,
            revisionNumber,
            sourceDraftVersion: content.draft.draftVersion,
            warnings: preview.warnings,
          },
        },
        transaction,
      );

      return freezeContent({
        ...content,
        status: nextStatus,
        version: input.contentVersion + 1,
        currentRevisionNumber: revisionNumber,
        readyRevisionNumber,
        updatedAt: createdAt,
      });
    });
  }
}

function requireAdminActorId(): string {
  const actorId = requestContext.require().actorId;

  if (!actorId) {
    throw new DomainError({
      code: ErrorCode.AUTH_REQUIRED,
      message: 'An authenticated administrator is required.',
    });
  }

  return actorId;
}

function freezeContent(content: ContentRecord): Readonly<ContentRecord> {
  return Object.freeze({
    ...content,
    createdAt: new Date(content.createdAt),
    updatedAt: new Date(content.updatedAt),
    archivedAt: content.archivedAt ? new Date(content.archivedAt) : undefined,
    draft: Object.freeze({
      ...content.draft,
      updatedAt: new Date(content.draft.updatedAt),
    }),
  });
}

function freezeRevision(
  revision: ContentRevisionRecord,
): Readonly<ContentRevisionRecord> {
  return Object.freeze({
    ...revision,
    createdAt: new Date(revision.createdAt),
  });
}

function normalizeLimit(value?: number): number {
  if (value === undefined) {
    return 25;
  }

  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Content list limit must be between 1 and 100.',
      details: { field: 'limit' },
    });
  }

  return value;
}

function normalizeSearch(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\s+/gu, ' ');

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > 120) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Content search query is too long.',
      details: { field: 'search' },
    });
  }

  return normalized;
}

function encodeCursor(cursor: ContentListCursor): string {
  return Buffer.from(
    JSON.stringify({ updatedAt: cursor.updatedAt.toISOString(), id: cursor.id }),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(value: string): ContentListCursor {
  try {
    if (value.length < 8 || value.length > 512) {
      throw new Error('invalid cursor');
    }

    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      updatedAt?: unknown;
      id?: unknown;
    };
    const updatedAt =
      typeof parsed.updatedAt === 'string' ? new Date(parsed.updatedAt) : undefined;

    if (
      !updatedAt ||
      Number.isNaN(updatedAt.getTime()) ||
      typeof parsed.id !== 'string' ||
      !/^[0-9a-f-]{36}$/u.test(parsed.id)
    ) {
      throw new Error('invalid cursor');
    }

    return { updatedAt, id: parsed.id };
  } catch {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Content list cursor is invalid.',
      details: { field: 'cursor' },
    });
  }
}

function assertPositiveVersion(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: `${field} is invalid.`,
      details: { field },
    });
  }
}

function contentNotFoundError(): DomainError {
  return new DomainError({
    code: ErrorCode.NOT_FOUND,
    message: 'Content was not found.',
  });
}

function versionConflictError(message: string): DomainError {
  return new DomainError({
    code: ErrorCode.VERSION_CONFLICT,
    message,
  });
}
