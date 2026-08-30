import { In, type DataSource, type EntityManager } from 'typeorm';

import type {
  ContentDraftRecord,
  ContentRecord,
  ContentRevisionKind,
  ContentRevisionRecord,
} from '../../domain/content';
import type {
  ArchiveContentInput,
  ContentListQuery,
  ContentRepositoryPort,
  InsertContentInput,
  InsertContentRevisionInput,
  RestoreContentDraftInput,
  UpdateContentDraftInput,
} from '../../ports/content.repository';
import {
  ContentDraftEntity,
  ContentEntity,
  ContentRevisionEntity,
} from './content.entities';

export class TypeOrmContentRepository
  implements ContentRepositoryPort<EntityManager>
{
  public constructor(private readonly dataSource: DataSource) {}

  public async list(
    workspaceId: string,
    query: ContentListQuery,
  ): Promise<readonly ContentRecord[]> {
    const builder = this.dataSource
      .getRepository(ContentEntity)
      .createQueryBuilder('content')
      .where('content.workspace_id = :workspaceId', { workspaceId });

    if (query.status) {
      builder.andWhere('content.status = :status', { status: query.status });
    }

    if (query.type) {
      builder.andWhere('content.type = :type', { type: query.type });
    }

    if (query.cursor) {
      builder.andWhere(
        '(content.updated_at < :updatedAt OR (content.updated_at = :updatedAt AND content.id < :id))',
        { updatedAt: query.cursor.updatedAt, id: query.cursor.id },
      );
    }

    if (query.search) {
      builder.innerJoin(
        ContentDraftEntity,
        'search_draft',
        'search_draft.content_id = content.id',
      );
      builder.andWhere(
        '(search_draft.title ILIKE :search OR search_draft.summary ILIKE :search OR search_draft.body_markdown ILIKE :search)',
        { search: `%${escapeLike(query.search)}%` },
      );
    }

    const contents = await builder
      .orderBy('content.updated_at', 'DESC')
      .addOrderBy('content.id', 'DESC')
      .take(query.limit)
      .getMany();

    return this.attachDrafts(contents, this.dataSource.manager);
  }

  public async findById(
    workspaceId: string,
    contentId: string,
    transaction?: EntityManager,
  ): Promise<ContentRecord | undefined> {
    const manager = transaction ?? this.dataSource.manager;
    const content = await manager.getRepository(ContentEntity).findOne({
      where: { id: contentId, workspaceId },
    });

    if (!content) {
      return undefined;
    }

    const draft = await manager.getRepository(ContentDraftEntity).findOne({
      where: { contentId, workspaceId },
    });

    return draft ? toContentRecord(content, draft) : undefined;
  }

  public async insert(
    input: InsertContentInput,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(ContentEntity).insert({
      id: input.content.id,
      workspaceId: input.content.workspaceId,
      type: input.content.type,
      status: input.content.status,
      version: input.content.version,
      currentRevisionNumber: input.content.currentRevisionNumber ?? null,
      readyRevisionNumber: input.content.readyRevisionNumber ?? null,
      archivedAt: input.content.archivedAt ?? null,
      createdByAdminAccountId: input.content.createdByAdminAccountId,
      createdAt: input.content.createdAt,
      updatedAt: input.content.updatedAt,
    });
    await transaction.getRepository(ContentDraftEntity).insert({
      contentId: input.draft.contentId,
      workspaceId: input.draft.workspaceId,
      title: input.draft.title,
      summary: input.draft.summary ?? null,
      bodyMarkdown: input.draft.bodyMarkdown,
      draftVersion: input.draft.draftVersion,
      updatedByAdminAccountId: input.draft.updatedByAdminAccountId,
      updatedAt: input.draft.updatedAt,
    });
  }

  public async updateDraft(
    workspaceId: string,
    contentId: string,
    input: UpdateContentDraftInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(ContentDraftEntity).update(
      {
        contentId,
        workspaceId,
        draftVersion: input.expectedDraftVersion,
      },
      {
        title: input.title,
        summary: input.summary ?? null,
        bodyMarkdown: input.bodyMarkdown,
        draftVersion: input.nextDraftVersion,
        updatedByAdminAccountId: input.updatedByAdminAccountId,
        updatedAt: input.updatedAt,
      },
    );

    if ((result.affected ?? 0) !== 1) {
      return false;
    }

    await transaction.getRepository(ContentEntity).update(
      { id: contentId, workspaceId },
      { updatedAt: input.updatedAt },
    );
    return true;
  }

  public async insertRevision(
    workspaceId: string,
    contentId: string,
    input: InsertContentRevisionInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    await transaction.getRepository(ContentRevisionEntity).insert({
      id: input.revision.id,
      contentId: input.revision.contentId,
      workspaceId: input.revision.workspaceId,
      revisionNumber: input.revision.revisionNumber,
      kind: input.revision.kind,
      title: input.revision.title,
      summary: input.revision.summary ?? null,
      bodyMarkdown: input.revision.bodyMarkdown,
      bodyHtml: input.revision.bodyHtml,
      sourceDraftVersion: input.revision.sourceDraftVersion,
      note: input.revision.note ?? null,
      createdByAdminAccountId: input.revision.createdByAdminAccountId,
      createdAt: input.revision.createdAt,
    });

    const result = await transaction.getRepository(ContentEntity).update(
      {
        id: contentId,
        workspaceId,
        version: input.expectedContentVersion,
      },
      {
        status: input.status,
        version: input.nextContentVersion,
        currentRevisionNumber: input.currentRevisionNumber,
        ...(input.readyRevisionNumber !== undefined
          ? { readyRevisionNumber: input.readyRevisionNumber }
          : {}),
        updatedAt: input.updatedAt,
      },
    );

    return (result.affected ?? 0) === 1;
  }

  public async listRevisions(
    workspaceId: string,
    contentId: string,
  ): Promise<readonly ContentRevisionRecord[]> {
    const entities = await this.dataSource
      .getRepository(ContentRevisionEntity)
      .find({
        where: { workspaceId, contentId },
        order: { revisionNumber: 'DESC' },
        take: 200,
      });

    return entities.map(toRevisionRecord);
  }

  public async findRevision(
    workspaceId: string,
    contentId: string,
    revisionId: string,
    transaction?: EntityManager,
  ): Promise<ContentRevisionRecord | undefined> {
    const entity = await (transaction ?? this.dataSource.manager)
      .getRepository(ContentRevisionEntity)
      .findOne({ where: { id: revisionId, contentId, workspaceId } });

    return entity ? toRevisionRecord(entity) : undefined;
  }

  public async restoreDraft(
    workspaceId: string,
    contentId: string,
    input: RestoreContentDraftInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    return this.updateDraft(workspaceId, contentId, input, transaction);
  }

  public async archive(
    workspaceId: string,
    contentId: string,
    input: ArchiveContentInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(ContentEntity).update(
      {
        id: contentId,
        workspaceId,
        version: input.expectedContentVersion,
      },
      {
        status: 'archived',
        version: input.nextContentVersion,
        archivedAt: input.archivedAt,
        updatedAt: input.archivedAt,
      },
    );

    return (result.affected ?? 0) === 1;
  }

  public async countRevisionKind(
    workspaceId: string,
    contentId: string,
    kind: ContentRevisionKind,
  ): Promise<number> {
    return this.dataSource.getRepository(ContentRevisionEntity).count({
      where: { workspaceId, contentId, kind },
    });
  }

  private async attachDrafts(
    contents: readonly ContentEntity[],
    manager: EntityManager,
  ): Promise<ContentRecord[]> {
    if (contents.length === 0) {
      return [];
    }

    const drafts = await manager.getRepository(ContentDraftEntity).find({
      where: { contentId: In(contents.map((content) => content.id)) },
    });
    const byContentId = new Map(drafts.map((draft) => [draft.contentId, draft]));

    return contents.flatMap((content) => {
      const draft = byContentId.get(content.id);
      return draft ? [toContentRecord(content, draft)] : [];
    });
  }
}

function toContentRecord(
  content: ContentEntity,
  draft: ContentDraftEntity,
): ContentRecord {
  return {
    id: content.id,
    workspaceId: content.workspaceId,
    type: content.type,
    status: content.status,
    version: content.version,
    currentRevisionNumber: content.currentRevisionNumber ?? undefined,
    readyRevisionNumber: content.readyRevisionNumber ?? undefined,
    archivedAt: content.archivedAt ? new Date(content.archivedAt) : undefined,
    createdByAdminAccountId: content.createdByAdminAccountId,
    createdAt: new Date(content.createdAt),
    updatedAt: new Date(content.updatedAt),
    draft: toDraftRecord(draft),
  };
}

function toDraftRecord(draft: ContentDraftEntity): ContentDraftRecord {
  return {
    contentId: draft.contentId,
    workspaceId: draft.workspaceId,
    title: draft.title,
    summary: draft.summary ?? undefined,
    bodyMarkdown: draft.bodyMarkdown,
    draftVersion: draft.draftVersion,
    updatedByAdminAccountId: draft.updatedByAdminAccountId,
    updatedAt: new Date(draft.updatedAt),
  };
}

function toRevisionRecord(
  revision: ContentRevisionEntity,
): ContentRevisionRecord {
  return {
    id: revision.id,
    contentId: revision.contentId,
    workspaceId: revision.workspaceId,
    revisionNumber: revision.revisionNumber,
    kind: revision.kind,
    title: revision.title,
    summary: revision.summary ?? undefined,
    bodyMarkdown: revision.bodyMarkdown,
    bodyHtml: revision.bodyHtml,
    sourceDraftVersion: revision.sourceDraftVersion,
    note: revision.note ?? undefined,
    createdByAdminAccountId: revision.createdByAdminAccountId,
    createdAt: new Date(revision.createdAt),
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}
