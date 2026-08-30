import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ActorType,
  AuditService,
  ContentDeliveryService,
  ContentPublicationService,
  ContentPublicationStatus,
  ContentRevisionKind,
  ContentSiteVisibility,
  ContentStatus,
  ContentType,
  FixedClock,
  PassthroughTransactionRunner,
  createContentPublicationEtag,
  createContentPublicationSnapshot,
  createUuidV7,
  normalizeContentSiteSeo,
  normalizeContentSiteSlug,
  requestContext,
  type AuditRecord,
  type AuditRepositoryPort,
  type ContentPublicationRecord,
  type ContentPublicationRepositoryPort,
  type ContentSiteRecord,
  type ContentSiteTargetRecord,
  type DeliveryContentRepositoryListQuery,
  type DeliveryContentRecord,
  type InsertContentPublicationInput,
  type InsertContentSiteInput,
  type PublishableContentRecord,
  type UpdateContentSiteRecordInput,
} from './index';

test('Publication ETag is deterministic and Site input normalization is strict', () => {
  assert.equal(normalizeContentSiteSlug('  Atlas-Phase-7  '), 'atlas-phase-7');
  assert.throws(() => normalizeContentSiteSlug('Atlas / Phase 7'));

  const leftSeo = normalizeContentSiteSeo({
    openGraph: { type: 'article', images: ['cover.webp'] },
    description: 'Atlas publication',
  });
  const rightSeo = normalizeContentSiteSeo({
    description: 'Atlas publication',
    openGraph: { images: ['cover.webp'], type: 'article' },
  });
  const revision = {
    id: createUuidV7(2),
    contentId: createUuidV7(1),
    workspaceId: createUuidV7(0),
    revisionNumber: 1,
    kind: ContentRevisionKind.READY,
    title: 'Atlas Publication',
    summary: 'Immutable publication snapshot',
    bodyMarkdown: '# Atlas',
    bodyHtml: '<h1>Atlas</h1>',
    sourceDraftVersion: 2,
    createdByAdminAccountId: createUuidV7(3),
    createdAt: new Date(2),
  } as const;

  const siteSnapshot = {
    siteId: createUuidV7(4),
    siteKey: 'main-blog',
    siteName: 'Main Blog',
  } as const;

  const left = createContentPublicationSnapshot(
    ContentType.POST,
    {
      contentId: revision.contentId,
      ...siteSnapshot,
      slug: 'atlas-phase-7',
      seo: leftSeo,
      visibility: ContentSiteVisibility.PUBLIC,
    },
    revision,
  );
  const right = createContentPublicationSnapshot(
    ContentType.POST,
    {
      contentId: revision.contentId,
      ...siteSnapshot,
      slug: 'atlas-phase-7',
      seo: rightSeo,
      visibility: ContentSiteVisibility.PUBLIC,
    },
    revision,
  );

  assert.equal(createContentPublicationEtag(left), createContentPublicationEtag(right));

  const renamedSite = createContentPublicationSnapshot(
    ContentType.POST,
    {
      contentId: revision.contentId,
      ...siteSnapshot,
      siteName: 'Renamed Main Blog',
      slug: 'atlas-phase-7',
      seo: rightSeo,
      visibility: ContentSiteVisibility.PUBLIC,
    },
    revision,
  );
  assert.notEqual(createContentPublicationEtag(left), createContentPublicationEtag(renamedSite));
});

test('Publish is idempotent, republish supersedes, and rollback creates a new active Snapshot', async () => {
  const clock = new FixedClock('2026-08-30T00:00:00.000Z');
  const repository = new FakeContentPublicationRepository();
  const auditRepository = new InMemoryAuditRepository();
  const service = new ContentPublicationService(
    new PassthroughTransactionRunner(),
    repository,
    new AuditService(auditRepository, clock),
    clock,
  );

  await requestContext.run(
    {
      requestId: createUuidV7(100),
      traceId: createUuidV7(101),
      actorType: ActorType.ADMIN,
      actorId: repository.adminId,
      workspaceId: repository.workspaceId,
    },
    async () => {
      const first = await service.publish(
        repository.workspaceId,
        repository.contentId,
        repository.contentSiteId,
      );
      const replay = await service.publish(
        repository.workspaceId,
        repository.contentId,
        repository.contentSiteId,
      );

      assert.equal(first.replayed, false);
      assert.equal(replay.replayed, true);
      assert.equal(replay.publication.id, first.publication.id);
      assert.equal(repository.publications.length, 1);
      assert.equal(auditRepository.records.length, 1);

      repository.advanceReadyRevision();
      clock.advanceBy(1_000);
      const second = await service.publish(
        repository.workspaceId,
        repository.contentId,
        repository.contentSiteId,
      );

      assert.equal(second.replayed, false);
      assert.equal(repository.publications.length, 2);
      assert.equal(repository.publications[0]?.status, ContentPublicationStatus.SUPERSEDED);
      assert.equal(repository.publications[1]?.status, ContentPublicationStatus.ACTIVE);
      assert.notEqual(second.publication.etag, first.publication.etag);

      clock.advanceBy(1_000);
      const rollback = await service.rollback(
        repository.workspaceId,
        repository.contentId,
        repository.contentSiteId,
        first.publication.id,
      );

      assert.equal(rollback.replayed, false);
      assert.equal(repository.publications.length, 3);
      assert.notEqual(rollback.publication.id, first.publication.id);
      assert.equal(rollback.publication.etag, first.publication.etag);
      assert.equal(repository.publications[1]?.status, ContentPublicationStatus.SUPERSEDED);
      assert.equal(repository.publications[2]?.status, ContentPublicationStatus.ACTIVE);
      assert.deepEqual(
        auditRepository.records.map((record) => record.action),
        ['content.published', 'content.published', 'content.publication-restored'],
      );
    },
  );
});

test('Delivery lists public records and resolves unlisted detail without exposing private detail', async () => {
  const repository = new FakeContentPublicationRepository();
  const service = new ContentDeliveryService(repository);
  repository.deliveryRecords = [
    repository.makeDeliveryRecord(ContentSiteVisibility.PUBLIC, 'public-post'),
  ];

  const list = await service.list(repository.workspaceId, repository.siteId, { limit: 10 });
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0]?.slug, 'public-post');

  repository.deliveryDetail = repository.makeDeliveryRecord(
    ContentSiteVisibility.UNLISTED,
    'unlisted-post',
  );
  const detail = await service.getBySlug(
    repository.workspaceId,
    repository.siteId,
    'unlisted-post',
  );
  assert.equal(detail.visibility, ContentSiteVisibility.UNLISTED);

  repository.deliveryDetail = undefined;
  await assert.rejects(() =>
    service.getBySlug(repository.workspaceId, repository.siteId, 'private-post'),
  );
});

class InMemoryAuditRepository implements AuditRepositoryPort<void> {
  public readonly records: AuditRecord[] = [];

  public async insert(record: AuditRecord): Promise<void> {
    this.records.push(record);
  }
}

class FakeContentPublicationRepository implements ContentPublicationRepositoryPort<void> {
  public readonly workspaceId = createUuidV7(10);
  public readonly contentId = createUuidV7(11);
  public readonly contentSiteId = createUuidV7(12);
  public readonly siteId = createUuidV7(13);
  public readonly adminId = createUuidV7(14);
  public readonly publications: ContentPublicationRecord[] = [];
  public deliveryRecords: DeliveryContentRecord[] = [];
  public deliveryDetail?: DeliveryContentRecord;

  private revisionNumber = 1;
  private revisionId = createUuidV7(20);

  public async listContentSites(): Promise<readonly ContentSiteRecord[]> {
    return [this.contentSite()];
  }

  public async findContentSite(): Promise<ContentSiteRecord | undefined> {
    return this.contentSite();
  }

  public async findContentSiteForUpdate(): Promise<ContentSiteRecord | undefined> {
    return this.contentSite();
  }

  public async findContentStatus() {
    return ContentStatus.READY;
  }

  public async findSiteTarget(): Promise<ContentSiteTargetRecord | undefined> {
    return {
      id: this.siteId,
      workspaceId: this.workspaceId,
      key: 'main-blog',
      name: 'Main Blog',
      status: 'active',
    };
  }

  public async insertContentSite(_input: InsertContentSiteInput): Promise<void> {}

  public async updateContentSite(
    _workspaceId: string,
    _contentId: string,
    _contentSiteId: string,
    _input: UpdateContentSiteRecordInput,
  ): Promise<boolean> {
    return true;
  }

  public async findPublishableContentForUpdate(): Promise<PublishableContentRecord | undefined> {
    return {
      id: this.contentId,
      workspaceId: this.workspaceId,
      type: ContentType.POST,
      status: ContentStatus.READY,
      readyRevisionNumber: this.revisionNumber,
      revision: {
        id: this.revisionId,
        contentId: this.contentId,
        workspaceId: this.workspaceId,
        revisionNumber: this.revisionNumber,
        kind: ContentRevisionKind.READY,
        title: `Atlas Publication ${this.revisionNumber}`,
        summary: 'Immutable Snapshot',
        bodyMarkdown: '# Atlas',
        bodyHtml: `<h1>Atlas ${this.revisionNumber}</h1>`,
        sourceDraftVersion: this.revisionNumber,
        createdByAdminAccountId: this.adminId,
        createdAt: new Date(this.revisionNumber),
      },
    };
  }

  public async findActivePublication(): Promise<ContentPublicationRecord | undefined> {
    return this.publications.find(
      (publication) => publication.status === ContentPublicationStatus.ACTIVE,
    );
  }

  public async findActiveSlugOwner(): Promise<string | undefined> {
    return this.publications.some(
      (publication) => publication.status === ContentPublicationStatus.ACTIVE,
    )
      ? this.contentSiteId
      : undefined;
  }

  public async supersedeActivePublication(
    _workspaceId: string,
    _contentSiteId: string,
    supersededAt: Date,
  ): Promise<void> {
    for (const publication of this.publications) {
      if (publication.status === ContentPublicationStatus.ACTIVE) {
        publication.status = ContentPublicationStatus.SUPERSEDED;
        publication.supersededAt = supersededAt;
      }
    }
  }

  public async insertPublication(input: InsertContentPublicationInput): Promise<void> {
    this.publications.push({ ...input });
  }

  public async withdrawActivePublication(
    _workspaceId: string,
    _contentSiteId: string,
    withdrawnAt: Date,
  ): Promise<boolean> {
    const active = this.publications.find(
      (publication) => publication.status === ContentPublicationStatus.ACTIVE,
    );

    if (!active) {
      return false;
    }

    active.status = ContentPublicationStatus.WITHDRAWN;
    active.withdrawnAt = withdrawnAt;
    return true;
  }

  public async listPublications(): Promise<readonly ContentPublicationRecord[]> {
    return [...this.publications].reverse();
  }

  public async findPublication(
    _workspaceId: string,
    _contentSiteId: string,
    publicationId: string,
  ): Promise<ContentPublicationRecord | undefined> {
    return this.publications.find((publication) => publication.id === publicationId);
  }

  public async listDeliveryContent(
    _workspaceId: string,
    _siteId: string,
    _query: DeliveryContentRepositoryListQuery,
  ): Promise<readonly DeliveryContentRecord[]> {
    return this.deliveryRecords;
  }

  public async findDeliveryContentBySlug(): Promise<DeliveryContentRecord | undefined> {
    return this.deliveryDetail;
  }

  public advanceReadyRevision(): void {
    this.revisionNumber += 1;
    this.revisionId = createUuidV7(20 + this.revisionNumber);
  }

  public makeDeliveryRecord(
    visibility: ContentSiteVisibility,
    slug: string,
  ): DeliveryContentRecord {
    return {
      schemaVersion: 1,
      publicationId: createUuidV7(200 + slug.length),
      contentId: this.contentId,
      contentType: ContentType.POST,
      revisionNumber: 1,
      site: { id: this.siteId, key: 'main-blog', name: 'Main Blog' },
      slug,
      title: 'Atlas',
      summary: 'Atlas publication',
      bodyHtml: '<p>Atlas</p>',
      seo: {},
      visibility,
      etag: 'a'.repeat(64),
      publishedAt: new Date('2026-08-30T00:00:00.000Z'),
    };
  }

  private contentSite(): ContentSiteRecord {
    const active = this.publications.find(
      (publication) => publication.status === ContentPublicationStatus.ACTIVE,
    );

    return {
      id: this.contentSiteId,
      workspaceId: this.workspaceId,
      contentId: this.contentId,
      siteId: this.siteId,
      siteKey: 'main-blog',
      siteName: 'Main Blog',
      siteStatus: 'active',
      slug: 'atlas-publication',
      seo: {},
      visibility: ContentSiteVisibility.PUBLIC,
      version: 1,
      activePublication: active
        ? {
            id: active.id,
            revisionId: active.revisionId,
            revisionNumber: active.revisionNumber,
            status: active.status,
            etag: active.etag,
            publishedAt: active.publishedAt,
          }
        : undefined,
      createdAt: new Date(10),
      updatedAt: new Date(10),
    };
  }
}
