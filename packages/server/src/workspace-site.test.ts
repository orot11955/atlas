import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ActorType,
  AdminRole,
  AuditService,
  DomainError,
  ErrorCode,
  FixedClock,
  SiteService,
  SiteStatus,
  SiteType,
  assertSiteStatusTransition,
  normalizeCanonicalHostname,
  normalizeSiteKey,
  requestContext,
  type AuditRecord,
  type AuditRepositoryPort,
  type InsertSiteRecordInput,
  type SiteListRepositoryQuery,
  type SiteRecord,
  type SiteRepositoryPort,
  type TouchAdminSessionInput,
  type TransactionRunner,
  type UpdateSiteRecordInput,
  type UpdateSiteStatusRecordInput,
} from './index';

type TestTransaction = Readonly<{ id: 'workspace-site-transaction' }>;

class TestTransactionRunner implements TransactionRunner<TestTransaction> {
  private readonly transaction: TestTransaction = Object.freeze({
    id: 'workspace-site-transaction',
  });

  public run<TResult>(
    work: (transaction: TestTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    return work(this.transaction);
  }
}

class MemorySiteRepository implements SiteRepositoryPort<TestTransaction> {
  public readonly sites = new Map<string, SiteRecord>();

  public async list(
    workspaceId: string,
    query: SiteListRepositoryQuery,
  ): Promise<readonly SiteRecord[]> {
    return [...this.sites.values()]
      .filter((site) => site.workspaceId === workspaceId)
      .filter((site) => !query.status || site.status === query.status)
      .filter((site) => !query.type || site.type === query.type)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, query.limit)
      .map(cloneSite);
  }

  public async findById(
    workspaceId: string,
    siteId: string,
  ): Promise<SiteRecord | undefined> {
    const site = this.sites.get(siteId);
    return site?.workspaceId === workspaceId ? cloneSite(site) : undefined;
  }

  public async findByKey(
    workspaceId: string,
    key: string,
  ): Promise<SiteRecord | undefined> {
    const site = [...this.sites.values()].find(
      (candidate) =>
        candidate.workspaceId === workspaceId && candidate.key === key,
    );
    return site ? cloneSite(site) : undefined;
  }

  public async findCanonicalDomainOwner(
    workspaceId: string,
    hostname: string,
  ): Promise<string | undefined> {
    return [...this.sites.values()].find(
      (site) =>
        site.workspaceId === workspaceId &&
        site.canonicalDomain?.hostname === hostname,
    )?.id;
  }

  public async insert(site: InsertSiteRecordInput): Promise<void> {
    this.sites.set(site.id, cloneSite(site));
  }

  public async update(
    workspaceId: string,
    siteId: string,
    input: UpdateSiteRecordInput,
  ): Promise<boolean> {
    const current = this.sites.get(siteId);

    if (
      !current ||
      current.workspaceId !== workspaceId ||
      current.version !== input.expectedVersion
    ) {
      return false;
    }

    this.sites.set(siteId, {
      ...current,
      name: input.name,
      description: input.description,
      type: input.type,
      timezone: input.timezone,
      locale: input.locale,
      version: input.nextVersion,
      updatedAt: new Date(input.updatedAt),
    });
    return true;
  }

  public async replaceCanonicalDomain(
    workspaceId: string,
    siteId: string,
    domain: SiteRecord['canonicalDomain'],
  ): Promise<void> {
    const current = this.sites.get(siteId);

    if (current?.workspaceId === workspaceId) {
      this.sites.set(siteId, {
        ...current,
        canonicalDomain: domain
          ? {
              ...domain,
              verifiedAt: domain.verifiedAt
                ? new Date(domain.verifiedAt)
                : undefined,
            }
          : undefined,
      });
    }
  }

  public async updateStatus(
    workspaceId: string,
    siteId: string,
    input: UpdateSiteStatusRecordInput,
  ): Promise<boolean> {
    const current = this.sites.get(siteId);

    if (
      !current ||
      current.workspaceId !== workspaceId ||
      current.version !== input.expectedVersion
    ) {
      return false;
    }

    this.sites.set(siteId, {
      ...current,
      status: input.status,
      version: input.nextVersion,
      archivedAt: input.archivedAt
        ? new Date(input.archivedAt)
        : undefined,
      updatedAt: new Date(input.updatedAt),
    });
    return true;
  }
}

class MemoryAuditRepository implements AuditRepositoryPort<TestTransaction> {
  public readonly records: AuditRecord[] = [];

  public async insert(record: AuditRecord): Promise<void> {
    this.records.push({ ...record });
  }
}

const workspaceId = '00000000-0000-7000-8000-000000000001';
const clock = new FixedClock('2026-08-30T00:00:00.000Z');

function createHarness() {
  const repository = new MemorySiteRepository();
  const auditRepository = new MemoryAuditRepository();
  const service = new SiteService(
    new TestTransactionRunner(),
    repository,
    new AuditService(auditRepository, clock),
    clock,
  );

  return { repository, auditRepository, service };
}

function runAsOwner<TResult>(work: () => Promise<TResult>): Promise<TResult> {
  return requestContext.run(
    {
      requestId: 'workspace-site-request',
      traceId: 'workspace-site-trace',
      actorType: ActorType.ADMIN,
      actorId: '00000000-0000-7000-8000-000000000002',
      workspaceId,
    },
    work,
  );
}

test('Site identifiers, canonical hostnames and lifecycle transitions are normalized', () => {
  assert.equal(normalizeSiteKey(' Main-Blog '), 'main-blog');
  assert.equal(normalizeCanonicalHostname('BLOG.Example.COM.'), 'blog.example.com');
  assert.throws(() => normalizeSiteKey('main_blog'), DomainError);
  assert.throws(() => normalizeCanonicalHostname('https://blog.example.com'), DomainError);
  assert.doesNotThrow(() => assertSiteStatusTransition(SiteStatus.DRAFT, SiteStatus.ACTIVE));
  assert.throws(
    () => assertSiteStatusTransition(SiteStatus.ACTIVE, SiteStatus.ARCHIVED),
    (error: unknown) => {
      assert.equal(error instanceof DomainError, true);
      assert.equal((error as DomainError).code, ErrorCode.INVALID_STATE_TRANSITION);
      return true;
    },
  );
});

test('Site service enforces Workspace-scoped key and domain uniqueness', async () => {
  const harness = createHarness();
  const mainBlog = await runAsOwner(() =>
    harness.service.createSite(workspaceId, {
      key: 'main-blog',
      name: 'Main Blog',
      type: SiteType.BLOG,
      timezone: 'Asia/Seoul',
      locale: 'ko-KR',
      canonicalDomain: 'blog.example.com',
    }),
  );

  assert.equal(mainBlog.status, SiteStatus.DRAFT);
  assert.equal(mainBlog.version, 1);
  assert.equal(mainBlog.canonicalDomain?.verificationStatus, 'pending');
  assert.equal(harness.auditRepository.records[0]?.action, 'site.created');
  assert.equal(harness.auditRepository.records[0]?.workspaceId, workspaceId);

  await assert.rejects(
    runAsOwner(() =>
      harness.service.createSite(workspaceId, {
        key: 'main-blog',
        name: 'Duplicate Key',
        type: SiteType.DOCS,
        timezone: 'Asia/Seoul',
        locale: 'ko-KR',
      }),
    ),
    (error: unknown) => {
      assert.equal(error instanceof DomainError, true);
      assert.equal((error as DomainError).code, ErrorCode.SITE_KEY_ALREADY_EXISTS);
      return true;
    },
  );

  await assert.rejects(
    runAsOwner(() =>
      harness.service.createSite(workspaceId, {
        key: 'dev-log',
        name: 'Dev Log',
        type: SiteType.BLOG,
        timezone: 'Asia/Seoul',
        locale: 'ko-KR',
        canonicalDomain: 'blog.example.com',
      }),
    ),
    (error: unknown) => {
      assert.equal(error instanceof DomainError, true);
      assert.equal((error as DomainError).code, ErrorCode.SITE_DOMAIN_ALREADY_EXISTS);
      return true;
    },
  );
});

test('Site service enforces optimistic versions and server-side status transitions', async () => {
  const harness = createHarness();
  const site = await runAsOwner(() =>
    harness.service.createSite(workspaceId, {
      key: 'photo-log',
      name: 'Photo Log',
      type: SiteType.PHOTO,
      timezone: 'Asia/Seoul',
      locale: 'ko-KR',
    }),
  );
  const active = await runAsOwner(() =>
    harness.service.changeStatus(
      workspaceId,
      site.id,
      SiteStatus.ACTIVE,
      site.version,
    ),
  );

  assert.equal(active.status, SiteStatus.ACTIVE);
  assert.equal(active.version, 2);

  await assert.rejects(
    runAsOwner(() =>
      harness.service.changeStatus(
        workspaceId,
        site.id,
        SiteStatus.ARCHIVED,
        active.version,
      ),
    ),
    (error: unknown) => {
      assert.equal(error instanceof DomainError, true);
      assert.equal((error as DomainError).code, ErrorCode.INVALID_STATE_TRANSITION);
      return true;
    },
  );

  await assert.rejects(
    runAsOwner(() =>
      harness.service.updateSite(workspaceId, site.id, {
        version: 1,
        name: 'Stale Update',
        type: SiteType.PHOTO,
        timezone: 'Asia/Seoul',
        locale: 'ko-KR',
      }),
    ),
    (error: unknown) => {
      assert.equal(error instanceof DomainError, true);
      assert.equal((error as DomainError).code, ErrorCode.VERSION_CONFLICT);
      return true;
    },
  );
});

function cloneSite(site: SiteRecord): SiteRecord {
  return {
    ...site,
    canonicalDomain: site.canonicalDomain
      ? {
          ...site.canonicalDomain,
          verifiedAt: site.canonicalDomain.verifiedAt
            ? new Date(site.canonicalDomain.verifiedAt)
            : undefined,
        }
      : undefined,
    archivedAt: site.archivedAt ? new Date(site.archivedAt) : undefined,
    createdAt: new Date(site.createdAt),
    updatedAt: new Date(site.updatedAt),
  };
}
