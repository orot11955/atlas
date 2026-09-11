import type { AuditService, Clock, TransactionRunner } from '../../../core';
import {
  ActorType,
  AuditResult,
  DomainError,
  ErrorCode,
  createUuidV7,
  isUuidV7,
  requestContext,
  systemClock,
} from '../../../core';
import {
  createContentPublicationAssetManifest,
  freezeContentPublicationAssetManifest,
  renderContentPublicationBodyHtml,
} from '../domain/content-asset';
import { ContentRevisionKind, ContentStatus, type ContentType } from '../domain/content';
import {
  ContentPublicationStatus,
  ContentSiteVisibility,
  assertContentCanReceiveSite,
  assertContentPublishable,
  assertSiteCanReceiveContent,
  assertSitePublishable,
  createContentPublicationEtag,
  createContentPublicationSnapshot,
  normalizeContentSiteSeo,
  normalizeContentSiteSlug,
  normalizeContentSiteSummaryOverride,
  normalizeContentSiteTitleOverride,
  normalizeContentSiteVisibility,
  type ContentPublicationRecord,
  type ContentSiteRecord,
  type ContentSiteVisibility as ContentSiteVisibilityType,
  type DeliveryContentRecord,
} from '../domain/content-publication';
import type { ContentAssetRepositoryPort } from '../ports/content-asset.repository';
import type {
  ContentPublicationRepositoryPort,
  DeliveryContentCursor,
} from '../ports/content-publication.repository';
import { EventType } from '../../eventing/domain/eventing';
import type { OutboxRecorderPort } from '../../eventing/ports/outbox-recorder.port';
import type { PublicAssetUrlBuilderPort } from '../ports/public-asset-url-builder.port';

export interface CreateContentSiteInput {
  siteId: string;
  slug: string;
  titleOverride?: string;
  summaryOverride?: string;
  seo?: Readonly<Record<string, unknown>>;
  visibility?: ContentSiteVisibilityType;
}

export interface UpdateContentSiteInput {
  version: number;
  slug: string;
  titleOverride?: string;
  summaryOverride?: string;
  seo?: Readonly<Record<string, unknown>>;
  visibility: ContentSiteVisibilityType;
}

export interface ContentPublicationMutationResult {
  publication: Readonly<ContentPublicationRecord>;
  replayed: boolean;
}

export interface DeliveryContentListQuery {
  limit?: number;
  cursor?: string;
  contentType?: ContentType;
}

export interface DeliveryContentListResult {
  items: readonly Readonly<DeliveryContentRecord>[];
  nextCursor?: string;
}

export class ContentPublicationService<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: ContentPublicationRepositoryPort<TTransaction>,
    private readonly auditService: AuditService<TTransaction>,
    private readonly assetRepository: ContentAssetRepositoryPort<TTransaction>,
    private readonly publicAssetUrlBuilder: PublicAssetUrlBuilderPort,
    private readonly clock: Clock = systemClock,
    private readonly outboxService?: OutboxRecorderPort<TTransaction>,
  ) {}

  public async listContentSites(
    workspaceId: string,
    contentId: string,
  ): Promise<readonly Readonly<ContentSiteRecord>[]> {
    const status = await this.repository.findContentStatus(workspaceId, contentId);

    if (!status) {
      throw contentNotFoundError();
    }

    const records = await this.repository.listContentSites(workspaceId, contentId);
    return Object.freeze(records.map(freezeContentSite));
  }

  public async createContentSite(
    workspaceId: string,
    contentId: string,
    input: CreateContentSiteInput,
  ): Promise<Readonly<ContentSiteRecord>> {
    const details = normalizeContentSiteInput(input);
    const createdAt = this.clock.now();
    const id = createUuidV7(createdAt.getTime());

    try {
      return await this.transactionRunner.run(async (transaction) => {
        const [contentStatus, site] = await Promise.all([
          this.repository.findContentStatus(workspaceId, contentId, transaction),
          this.repository.findSiteTarget(workspaceId, input.siteId, transaction),
        ]);

        if (!contentStatus) {
          throw contentNotFoundError();
        }
        if (!site) {
          throw siteNotFoundError();
        }

        assertContentCanReceiveSite(contentStatus);
        assertSiteCanReceiveContent(site.status);
        await this.repository.insertContentSite(
          {
            id,
            workspaceId,
            contentId,
            siteId: site.id,
            ...details,
            version: 1,
            createdAt,
            updatedAt: createdAt,
          },
          transaction,
        );
        await this.auditService.record(
          {
            action: 'content.site-assigned',
            targetType: 'content-site',
            targetId: id,
            result: AuditResult.SUCCESS,
            metadata: {
              contentId,
              siteId: site.id,
              slug: details.slug,
              visibility: details.visibility,
            },
          },
          transaction,
        );

        return freezeContentSite({
          id,
          workspaceId,
          contentId,
          siteId: site.id,
          siteKey: site.key,
          siteName: site.name,
          siteStatus: site.status,
          ...details,
          version: 1,
          createdAt,
          updatedAt: createdAt,
        });
      });
    } catch (error) {
      throw mapPublicationConstraintError(error);
    }
  }

  public async updateContentSite(
    workspaceId: string,
    contentId: string,
    contentSiteId: string,
    input: UpdateContentSiteInput,
  ): Promise<Readonly<ContentSiteRecord>> {
    assertPositiveVersion(input.version, 'version');
    const details = normalizeContentSiteInput(input);
    const updatedAt = this.clock.now();

    try {
      return await this.transactionRunner.run(async (transaction) => {
        const current = await this.repository.findContentSiteForUpdate(
          workspaceId,
          contentId,
          contentSiteId,
          transaction,
        );

        if (!current) {
          throw contentSiteNotFoundError();
        }

        const contentStatus = await this.repository.findContentStatus(
          workspaceId,
          contentId,
          transaction,
        );

        if (!contentStatus) {
          throw contentNotFoundError();
        }

        assertContentCanReceiveSite(contentStatus);
        const updated = await this.repository.updateContentSite(
          workspaceId,
          contentId,
          contentSiteId,
          {
            expectedVersion: input.version,
            nextVersion: input.version + 1,
            ...details,
            updatedAt,
          },
          transaction,
        );

        if (!updated) {
          throw versionConflictError('Content Site assignment was changed by another request.');
        }

        await this.auditService.record(
          {
            action: 'content.site-updated',
            targetType: 'content-site',
            targetId: contentSiteId,
            result: AuditResult.SUCCESS,
            metadata: {
              contentId,
              siteId: current.siteId,
              slug: details.slug,
              visibility: details.visibility,
              version: input.version + 1,
            },
          },
          transaction,
        );

        return freezeContentSite({
          ...current,
          ...details,
          version: input.version + 1,
          updatedAt,
        });
      });
    } catch (error) {
      throw mapPublicationConstraintError(error);
    }
  }

  public publish(
    workspaceId: string,
    contentId: string,
    contentSiteId: string,
  ): Promise<Readonly<ContentPublicationMutationResult>> {
    return this.publishWithRevision(workspaceId, contentId, contentSiteId);
  }

  public publishRevision(
    workspaceId: string,
    contentId: string,
    contentSiteId: string,
    revisionId: string,
  ): Promise<Readonly<ContentPublicationMutationResult>> {
    if (!isUuidV7(revisionId)) {
      throw new DomainError({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Scheduled Publication revision ID must be a UUIDv7.',
        details: { field: 'revisionId' },
      });
    }

    return this.publishWithRevision(workspaceId, contentId, contentSiteId, revisionId);
  }

  private async publishWithRevision(
    workspaceId: string,
    contentId: string,
    contentSiteId: string,
    revisionId?: string,
  ): Promise<Readonly<ContentPublicationMutationResult>> {
    const actorId = requireAdminActorId();
    const publishedAt = this.clock.now();

    try {
      return await this.transactionRunner.run(async (transaction) => {
        const contentSite = await this.repository.findContentSiteForUpdate(
          workspaceId,
          contentId,
          contentSiteId,
          transaction,
        );

        if (!contentSite) {
          throw contentSiteNotFoundError();
        }

        const [content, site] = await Promise.all([
          revisionId
            ? this.repository.findPublishableRevisionForUpdate(
                workspaceId,
                contentId,
                revisionId,
                transaction,
              )
            : this.repository.findPublishableContentForUpdate(workspaceId, contentId, transaction),
          this.repository.findSiteTarget(workspaceId, contentSite.siteId, transaction),
        ]);

        if (!content) {
          throw contentNotFoundError();
        }
        if (!site) {
          throw siteNotFoundError();
        }

        const revision = revisionId
          ? assertScheduledRevisionPublishable(content, revisionId)
          : assertContentPublishable(content);
        assertSitePublishable(site.status);
        const assetSources = await this.assetRepository.listRevisionPublicationSources(
          workspaceId,
          revision.id,
          transaction,
        );
        const assets = createContentPublicationAssetManifest(assetSources, (objectKey) =>
          this.publicAssetUrlBuilder.buildPublicUrl(objectKey),
        );
        const snapshot = createContentPublicationSnapshot(content.type, contentSite, revision, {
          assets,
          bodyHtml: renderContentPublicationBodyHtml(revision.bodyMarkdown, assets),
        });
        const etag = createContentPublicationEtag(snapshot);
        const active = await this.repository.findActivePublication(
          workspaceId,
          contentSiteId,
          transaction,
        );

        if (active?.etag === etag) {
          return Object.freeze({ publication: freezePublication(active), replayed: true });
        }

        await this.assertActiveSlugAvailable(
          workspaceId,
          contentSite.siteId,
          snapshot.slug,
          contentSiteId,
          transaction,
        );
        await this.repository.supersedeActivePublication(
          workspaceId,
          contentSiteId,
          publishedAt,
          transaction,
        );

        const publication: ContentPublicationRecord = {
          id: createUuidV7(publishedAt.getTime()),
          workspaceId,
          contentSiteId,
          contentId,
          contentType: snapshot.contentType,
          siteId: contentSite.siteId,
          siteKey: contentSite.siteKey,
          siteName: contentSite.siteName,
          revisionId: snapshot.revisionId,
          revisionNumber: snapshot.revisionNumber,
          status: ContentPublicationStatus.ACTIVE,
          slug: snapshot.slug,
          title: snapshot.title,
          summary: snapshot.summary,
          bodyHtml: snapshot.bodyHtml,
          assets: snapshot.assets,
          seo: snapshot.seo,
          visibility: snapshot.visibility,
          etag,
          publishedAt,
          createdByAdminAccountId: actorId,
          createdAt: publishedAt,
        };

        await this.repository.insertPublication(publication, transaction);
        await this.auditService.record(
          {
            action: 'content.published',
            targetType: 'content-publication',
            targetId: publication.id,
            result: AuditResult.SUCCESS,
            metadata: {
              contentId,
              contentSiteId,
              siteId: contentSite.siteId,
              revisionId: revision.id,
              revisionNumber: revision.revisionNumber,
              replacedPublicationId: active?.id,
              slug: snapshot.slug,
              visibility: snapshot.visibility,
              scheduled: revisionId !== undefined,
            },
          },
          transaction,
        );
        await this.outboxService?.record(
          {
            workspaceId,
            siteId: contentSite.siteId,
            aggregateType: 'content-publication',
            aggregateId: publication.id,
            eventType: EventType.CONTENT_PUBLISHED,
            data: {
              publicationId: publication.id,
              contentId,
              contentSiteId,
              revisionId: revision.id,
              revisionNumber: revision.revisionNumber,
              replacedPublicationId: active?.id ?? null,
              slug: snapshot.slug,
              visibility: snapshot.visibility,
              etag,
              scheduled: revisionId !== undefined,
            },
          },
          transaction,
        );

        return Object.freeze({ publication: freezePublication(publication), replayed: false });
      });
    } catch (error) {
      throw mapPublicationConstraintError(error);
    }
  }

  public async withdraw(
    workspaceId: string,
    contentId: string,
    contentSiteId: string,
  ): Promise<Readonly<ContentPublicationRecord>> {
    const withdrawnAt = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const contentSite = await this.repository.findContentSiteForUpdate(
        workspaceId,
        contentId,
        contentSiteId,
        transaction,
      );

      if (!contentSite) {
        throw contentSiteNotFoundError();
      }

      const active = await this.repository.findActivePublication(
        workspaceId,
        contentSiteId,
        transaction,
      );

      if (!active) {
        throw new DomainError({
          code: ErrorCode.INVALID_STATE_TRANSITION,
          message: 'Content Site does not have an active Publication to withdraw.',
        });
      }

      const withdrawn = await this.repository.withdrawActivePublication(
        workspaceId,
        contentSiteId,
        withdrawnAt,
        transaction,
      );

      if (!withdrawn) {
        throw versionConflictError('Active Publication was changed by another request.');
      }

      await this.auditService.record(
        {
          action: 'content.publication-withdrawn',
          targetType: 'content-publication',
          targetId: active.id,
          result: AuditResult.SUCCESS,
          metadata: {
            contentId,
            contentSiteId,
            siteId: contentSite.siteId,
            revisionId: active.revisionId,
            revisionNumber: active.revisionNumber,
          },
        },
        transaction,
      );
      await this.outboxService?.record(
        {
          workspaceId,
          siteId: contentSite.siteId,
          aggregateType: 'content-publication',
          aggregateId: active.id,
          eventType: EventType.CONTENT_UNPUBLISHED,
          data: {
            publicationId: active.id,
            contentId,
            contentSiteId,
            revisionId: active.revisionId,
            revisionNumber: active.revisionNumber,
            slug: active.slug,
            etag: active.etag,
          },
        },
        transaction,
      );

      return freezePublication({
        ...active,
        status: ContentPublicationStatus.WITHDRAWN,
        withdrawnAt,
      });
    });
  }

  public async listPublications(
    workspaceId: string,
    contentId: string,
    contentSiteId: string,
  ): Promise<readonly Readonly<ContentPublicationRecord>[]> {
    const contentSite = await this.repository.findContentSite(
      workspaceId,
      contentId,
      contentSiteId,
    );

    if (!contentSite) {
      throw contentSiteNotFoundError();
    }

    const records = await this.repository.listPublications(workspaceId, contentSiteId);
    return Object.freeze(records.map(freezePublication));
  }

  public async rollback(
    workspaceId: string,
    contentId: string,
    contentSiteId: string,
    sourcePublicationId: string,
  ): Promise<Readonly<ContentPublicationMutationResult>> {
    const actorId = requireAdminActorId();
    const publishedAt = this.clock.now();

    try {
      return await this.transactionRunner.run(async (transaction) => {
        const contentSite = await this.repository.findContentSiteForUpdate(
          workspaceId,
          contentId,
          contentSiteId,
          transaction,
        );

        if (!contentSite) {
          throw contentSiteNotFoundError();
        }

        const [contentStatus, site, source, active] = await Promise.all([
          this.repository.findContentStatus(workspaceId, contentId, transaction),
          this.repository.findSiteTarget(workspaceId, contentSite.siteId, transaction),
          this.repository.findPublication(
            workspaceId,
            contentSiteId,
            sourcePublicationId,
            transaction,
          ),
          this.repository.findActivePublication(workspaceId, contentSiteId, transaction),
        ]);

        if (!contentStatus) {
          throw contentNotFoundError();
        }
        if (!site) {
          throw siteNotFoundError();
        }
        if (!source) {
          throw publicationNotFoundError();
        }

        assertContentCanReceiveSite(contentStatus);
        assertSitePublishable(site.status);

        if (active?.etag === source.etag) {
          return Object.freeze({ publication: freezePublication(active), replayed: true });
        }

        await this.assertActiveSlugAvailable(
          workspaceId,
          contentSite.siteId,
          source.slug,
          contentSiteId,
          transaction,
        );
        await this.repository.supersedeActivePublication(
          workspaceId,
          contentSiteId,
          publishedAt,
          transaction,
        );

        const restored: ContentPublicationRecord = {
          ...source,
          id: createUuidV7(publishedAt.getTime()),
          status: ContentPublicationStatus.ACTIVE,
          supersededAt: undefined,
          withdrawnAt: undefined,
          publishedAt,
          createdByAdminAccountId: actorId,
          createdAt: publishedAt,
        };

        await this.repository.insertPublication(restored, transaction);
        await this.auditService.record(
          {
            action: 'content.publication-restored',
            targetType: 'content-publication',
            targetId: restored.id,
            result: AuditResult.SUCCESS,
            metadata: {
              contentId,
              contentSiteId,
              siteId: contentSite.siteId,
              sourcePublicationId,
              replacedPublicationId: active?.id,
              revisionId: source.revisionId,
              revisionNumber: source.revisionNumber,
              slug: source.slug,
              visibility: source.visibility,
            },
          },
          transaction,
        );
        await this.outboxService?.record(
          {
            workspaceId,
            siteId: contentSite.siteId,
            aggregateType: 'content-publication',
            aggregateId: restored.id,
            eventType: EventType.CONTENT_PUBLISHED,
            data: {
              publicationId: restored.id,
              contentId,
              contentSiteId,
              sourcePublicationId,
              revisionId: source.revisionId,
              revisionNumber: source.revisionNumber,
              replacedPublicationId: active?.id ?? null,
              slug: source.slug,
              visibility: source.visibility,
              etag: source.etag,
            },
          },
          transaction,
        );

        return Object.freeze({ publication: freezePublication(restored), replayed: false });
      });
    } catch (error) {
      throw mapPublicationConstraintError(error);
    }
  }

  private async assertActiveSlugAvailable(
    workspaceId: string,
    siteId: string,
    slug: string,
    contentSiteId: string,
    transaction: TTransaction,
  ): Promise<void> {
    const owner = await this.repository.findActiveSlugOwner(workspaceId, siteId, slug, transaction);

    if (owner && owner !== contentSiteId) {
      throw new DomainError({
        code: ErrorCode.VERSION_CONFLICT,
        message: 'Another active Publication already uses this Slug on the Site.',
        details: { field: 'slug' },
      });
    }
  }
}

export class ContentDeliveryService<TTransaction = unknown> {
  public constructor(private readonly repository: ContentPublicationRepositoryPort<TTransaction>) {}

  public async list(
    workspaceId: string,
    siteId: string,
    query: DeliveryContentListQuery = {},
  ): Promise<Readonly<DeliveryContentListResult>> {
    const limit = normalizeDeliveryLimit(query.limit);
    const records = await this.repository.listDeliveryContent(workspaceId, siteId, {
      limit: limit + 1,
      cursor: query.cursor ? decodeDeliveryCursor(query.cursor) : undefined,
      contentType: query.contentType,
    });
    const hasNext = records.length > limit;
    const items = records.slice(0, limit).map(freezeDeliveryContent);
    const last = items.at(-1);

    return Object.freeze({
      items: Object.freeze(items),
      ...(hasNext && last
        ? {
            nextCursor: encodeDeliveryCursor({
              publishedAt: last.publishedAt,
              id: last.publicationId,
            }),
          }
        : {}),
    });
  }

  public async getBySlug(
    workspaceId: string,
    siteId: string,
    slug: string,
    contentType?: ContentType,
  ): Promise<Readonly<DeliveryContentRecord>> {
    const record = await this.repository.findDeliveryContentBySlug(
      workspaceId,
      siteId,
      normalizeContentSiteSlug(slug),
      contentType,
    );

    if (!record) {
      throw new DomainError({
        code: ErrorCode.NOT_FOUND,
        message: 'Published Content was not found.',
      });
    }

    return freezeDeliveryContent(record);
  }
}

function normalizeContentSiteInput(input: {
  slug: string;
  titleOverride?: string;
  summaryOverride?: string;
  seo?: Readonly<Record<string, unknown>>;
  visibility?: string;
}) {
  return {
    slug: normalizeContentSiteSlug(input.slug),
    titleOverride: normalizeContentSiteTitleOverride(input.titleOverride),
    summaryOverride: normalizeContentSiteSummaryOverride(input.summaryOverride),
    seo: normalizeContentSiteSeo(input.seo),
    visibility: normalizeContentSiteVisibility(input.visibility ?? ContentSiteVisibility.PUBLIC),
  };
}

function assertScheduledRevisionPublishable(
  content: import('../domain/content-publication').PublishableContentRecord,
  expectedRevisionId: string,
) {
  if (content.status === ContentStatus.ARCHIVED) {
    throw new DomainError({
      code: ErrorCode.ACTION_NOT_ALLOWED,
      message: 'Archived Content cannot be published.',
    });
  }

  const revision = content.revision;

  if (
    !revision ||
    revision.id !== expectedRevisionId ||
    revision.kind !== ContentRevisionKind.READY
  ) {
    throw new DomainError({
      code: ErrorCode.INVALID_STATE_TRANSITION,
      message: 'The scheduled READY Revision is no longer available for publication.',
    });
  }

  return revision;
}

function requireAdminActorId(): string {
  const context = requestContext.require();

  if (context.actorType !== ActorType.ADMIN || !context.actorId) {
    throw new DomainError({
      code: ErrorCode.AUTH_REQUIRED,
      message: 'An authenticated administrator is required.',
    });
  }

  return context.actorId;
}

function assertPositiveVersion(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: `${field} must be a positive safe integer.`,
      details: { field },
    });
  }
}

function normalizeDeliveryLimit(value?: number): number {
  if (value === undefined) {
    return 20;
  }

  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Delivery Content limit must be between 1 and 100.',
      details: { field: 'limit' },
    });
  }

  return value;
}

function encodeDeliveryCursor(cursor: DeliveryContentCursor): string {
  return Buffer.from(
    JSON.stringify({ publishedAt: cursor.publishedAt.toISOString(), id: cursor.id }),
    'utf8',
  ).toString('base64url');
}

function decodeDeliveryCursor(value: string): DeliveryContentCursor {
  try {
    if (value.length < 8 || value.length > 512) {
      throw new Error('invalid cursor length');
    }

    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      publishedAt?: unknown;
      id?: unknown;
    };

    if (
      typeof parsed.publishedAt !== 'string' ||
      typeof parsed.id !== 'string' ||
      !isUuidV7(parsed.id)
    ) {
      throw new Error('invalid cursor fields');
    }

    const publishedAt = new Date(parsed.publishedAt);

    if (Number.isNaN(publishedAt.getTime())) {
      throw new Error('invalid cursor date');
    }

    return { publishedAt, id: parsed.id };
  } catch {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Delivery Content cursor is invalid.',
      details: { field: 'cursor' },
    });
  }
}

function freezeContentSite(record: ContentSiteRecord): Readonly<ContentSiteRecord> {
  return Object.freeze({
    ...record,
    seo: Object.freeze({ ...record.seo }),
    activePublication: record.activePublication
      ? Object.freeze({
          ...record.activePublication,
          publishedAt: new Date(record.activePublication.publishedAt),
        })
      : undefined,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  });
}

function freezePublication(record: ContentPublicationRecord): Readonly<ContentPublicationRecord> {
  return Object.freeze({
    ...record,
    seo: Object.freeze({ ...record.seo }),
    assets: freezeContentPublicationAssetManifest(record.assets),
    publishedAt: new Date(record.publishedAt),
    supersededAt: record.supersededAt ? new Date(record.supersededAt) : undefined,
    withdrawnAt: record.withdrawnAt ? new Date(record.withdrawnAt) : undefined,
    createdAt: new Date(record.createdAt),
  });
}

function freezeDeliveryContent(record: DeliveryContentRecord): Readonly<DeliveryContentRecord> {
  return Object.freeze({
    ...record,
    site: Object.freeze({ ...record.site }),
    seo: Object.freeze({ ...record.seo }),
    assets: freezeContentPublicationAssetManifest(record.assets),
    publishedAt: new Date(record.publishedAt),
  });
}

function contentNotFoundError(): DomainError {
  return new DomainError({
    code: ErrorCode.NOT_FOUND,
    message: 'Content was not found.',
  });
}

function siteNotFoundError(): DomainError {
  return new DomainError({
    code: ErrorCode.NOT_FOUND,
    message: 'Site was not found.',
  });
}

function contentSiteNotFoundError(): DomainError {
  return new DomainError({
    code: ErrorCode.NOT_FOUND,
    message: 'Content Site assignment was not found.',
  });
}

function publicationNotFoundError(): DomainError {
  return new DomainError({
    code: ErrorCode.NOT_FOUND,
    message: 'Content Publication was not found.',
  });
}

function versionConflictError(message: string): DomainError {
  return new DomainError({
    code: ErrorCode.VERSION_CONFLICT,
    message,
  });
}

function mapPublicationConstraintError(error: unknown): unknown {
  if (error instanceof DomainError) {
    return error;
  }

  const code = readDatabaseErrorCode(error);

  if (code === '23505') {
    return new DomainError({
      code: ErrorCode.VERSION_CONFLICT,
      message: 'Content Site or active Publication conflicts with an existing record.',
    });
  }

  return error;
}

function readDatabaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const record = error as { code?: unknown; driverError?: { code?: unknown } };
  const code = record.driverError?.code ?? record.code;
  return typeof code === 'string' ? code : undefined;
}
