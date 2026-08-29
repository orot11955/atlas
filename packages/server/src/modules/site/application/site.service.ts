import type { AuditService, Clock, TransactionRunner } from '../../../core';
import {
  AuditResult,
  DomainError,
  ErrorCode,
  createUuidV7,
  systemClock,
} from '../../../core';
import {
  SiteDomainVerificationStatus,
  SiteStatus,
  assertSiteEditable,
  assertSiteStatusTransition,
  normalizeCanonicalHostname,
  normalizeSiteDescription,
  normalizeSiteKey,
  normalizeSiteLocale,
  normalizeSiteName,
  normalizeSiteTimezone,
  normalizeSiteType,
  type CreateSiteDetails,
  type SiteCanonicalDomain,
  type SiteRecord,
  type SiteStatus as SiteStatusType,
  type SiteType,
  type UpdateSiteDetails,
} from '../domain/site';
import type {
  SiteListCursor,
  SiteRepositoryPort,
} from '../ports/site.repository';

export interface SiteListQuery {
  limit?: number;
  cursor?: string;
  status?: SiteStatusType;
  type?: SiteType;
  search?: string;
}

export interface SiteListResult {
  items: readonly Readonly<SiteRecord>[];
  nextCursor?: string;
}

export interface UpdateSiteInput extends UpdateSiteDetails {
  version: number;
}

export class SiteService<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: SiteRepositoryPort<TTransaction>,
    private readonly auditService: AuditService<TTransaction>,
    private readonly clock: Clock = systemClock,
  ) {}

  public async listSites(
    workspaceId: string,
    query: SiteListQuery = {},
  ): Promise<Readonly<SiteListResult>> {
    const limit = normalizeLimit(query.limit);
    const search = normalizeSearch(query.search);
    const records = await this.repository.list(workspaceId, {
      limit: limit + 1,
      cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
      status: query.status,
      type: query.type,
      search,
    });
    const hasNext = records.length > limit;
    const items = records.slice(0, limit).map((record) => Object.freeze(record));
    const last = items.at(-1);

    return Object.freeze({
      items: Object.freeze(items),
      ...(hasNext && last
        ? { nextCursor: encodeCursor({ createdAt: last.createdAt, id: last.id }) }
        : {}),
    });
  }

  public async getSite(
    workspaceId: string,
    siteId: string,
  ): Promise<Readonly<SiteRecord>> {
    const site = await this.repository.findById(workspaceId, siteId);

    if (!site) {
      throw siteNotFoundError();
    }

    return Object.freeze(site);
  }

  public async createSite(
    workspaceId: string,
    input: CreateSiteDetails,
  ): Promise<Readonly<SiteRecord>> {
    const key = normalizeSiteKey(input.key);
    const name = normalizeSiteName(input.name);
    const description = normalizeSiteDescription(input.description);
    const type = normalizeSiteType(input.type);
    const timezone = normalizeSiteTimezone(input.timezone);
    const locale = normalizeSiteLocale(input.locale);
    const hostname = normalizeCanonicalHostname(input.canonicalDomain);
    const now = this.clock.now();
    const id = createUuidV7(now.getTime());

    return this.transactionRunner.run(async (transaction) => {
      if (await this.repository.findByKey(workspaceId, key, transaction)) {
        throw new DomainError({
          code: ErrorCode.SITE_KEY_ALREADY_EXISTS,
          message: 'Site key is already in use in this Workspace.',
          details: { field: 'key' },
        });
      }

      await this.assertDomainAvailable(workspaceId, hostname, undefined, transaction);
      const canonicalDomain = hostname
        ? createPendingCanonicalDomain(hostname, now)
        : undefined;
      const site: SiteRecord = {
        id,
        workspaceId,
        key,
        name,
        description,
        type,
        status: SiteStatus.DRAFT,
        timezone,
        locale,
        version: 1,
        canonicalDomain,
        createdAt: now,
        updatedAt: now,
      };

      await this.repository.insert(site, transaction);
      await this.auditService.record(
        {
          action: 'site.created',
          targetType: 'site',
          targetId: id,
          result: AuditResult.SUCCESS,
          metadata: {
            key,
            type,
            status: SiteStatus.DRAFT,
            hasCanonicalDomain: Boolean(hostname),
          },
        },
        transaction,
      );

      return Object.freeze(site);
    });
  }

  public async updateSite(
    workspaceId: string,
    siteId: string,
    input: UpdateSiteInput,
  ): Promise<Readonly<SiteRecord>> {
    assertPositiveVersion(input.version);
    const name = normalizeSiteName(input.name);
    const description = normalizeSiteDescription(input.description);
    const type = normalizeSiteType(input.type);
    const timezone = normalizeSiteTimezone(input.timezone);
    const locale = normalizeSiteLocale(input.locale);
    const hostname = normalizeCanonicalHostname(input.canonicalDomain);
    const now = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findById(workspaceId, siteId, transaction);

      if (!current) {
        throw siteNotFoundError();
      }

      assertSiteEditable(current.status);
      await this.assertDomainAvailable(workspaceId, hostname, siteId, transaction);
      const domainChanged = current.canonicalDomain?.hostname !== hostname;
      const canonicalDomain = domainChanged
        ? hostname
          ? createPendingCanonicalDomain(hostname, now)
          : undefined
        : current.canonicalDomain;
      const updated = await this.repository.update(
        workspaceId,
        siteId,
        {
          name,
          description,
          type,
          timezone,
          locale,
          expectedVersion: input.version,
          nextVersion: input.version + 1,
          updatedAt: now,
        },
        transaction,
      );

      if (!updated) {
        throw versionConflictError();
      }

      if (domainChanged) {
        await this.repository.replaceCanonicalDomain(
          workspaceId,
          siteId,
          canonicalDomain,
          now,
          transaction,
        );
      }

      await this.auditService.record(
        {
          action: 'site.updated',
          targetType: 'site',
          targetId: siteId,
          result: AuditResult.SUCCESS,
          metadata: {
            changedFields: [
              'name',
              'description',
              'type',
              'timezone',
              'locale',
              ...(domainChanged ? ['canonicalDomain'] : []),
            ],
            version: input.version + 1,
          },
        },
        transaction,
      );

      return Object.freeze({
        ...current,
        name,
        description,
        type,
        timezone,
        locale,
        canonicalDomain,
        version: input.version + 1,
        updatedAt: now,
      });
    });
  }

  public async changeStatus(
    workspaceId: string,
    siteId: string,
    target: SiteStatusType,
    version: number,
  ): Promise<Readonly<SiteRecord>> {
    assertPositiveVersion(version);
    const now = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findById(workspaceId, siteId, transaction);

      if (!current) {
        throw siteNotFoundError();
      }

      assertSiteStatusTransition(current.status, target);

      if (current.status === target) {
        return Object.freeze(current);
      }

      const archivedAt = target === SiteStatus.ARCHIVED ? now : undefined;
      const updated = await this.repository.updateStatus(
        workspaceId,
        siteId,
        {
          status: target,
          expectedVersion: version,
          nextVersion: version + 1,
          archivedAt,
          updatedAt: now,
        },
        transaction,
      );

      if (!updated) {
        throw versionConflictError();
      }

      await this.auditService.record(
        {
          action: 'site.status-changed',
          targetType: 'site',
          targetId: siteId,
          result: AuditResult.SUCCESS,
          metadata: {
            previousStatus: current.status,
            status: target,
            version: version + 1,
          },
        },
        transaction,
      );

      return Object.freeze({
        ...current,
        status: target,
        version: version + 1,
        archivedAt,
        updatedAt: now,
      });
    });
  }

  private async assertDomainAvailable(
    workspaceId: string,
    hostname: string | undefined,
    currentSiteId: string | undefined,
    transaction: TTransaction,
  ): Promise<void> {
    if (!hostname) {
      return;
    }

    const owner = await this.repository.findCanonicalDomainOwner(
      workspaceId,
      hostname,
      transaction,
    );

    if (owner && owner !== currentSiteId) {
      throw new DomainError({
        code: ErrorCode.SITE_DOMAIN_ALREADY_EXISTS,
        message: 'Canonical domain is already assigned to another Site.',
        details: { field: 'canonicalDomain' },
      });
    }
  }
}

function createPendingCanonicalDomain(
  hostname: string,
  now: Date,
): SiteCanonicalDomain {
  return {
    id: createUuidV7(now.getTime()),
    hostname,
    verificationStatus: SiteDomainVerificationStatus.PENDING,
  };
}

function normalizeLimit(value?: number): number {
  if (value === undefined) {
    return 25;
  }

  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Site list limit must be between 1 and 100.',
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
      message: 'Site search query is too long.',
      details: { field: 'search' },
    });
  }

  return normalized;
}

function encodeCursor(cursor: SiteListCursor): string {
  return Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(value: string): SiteListCursor {
  if (value.length < 8 || value.length > 512) {
    throw invalidCursorError();
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      id?: unknown;
    };
    const createdAt =
      typeof parsed.createdAt === 'string' ? new Date(parsed.createdAt) : undefined;

    if (
      !createdAt ||
      Number.isNaN(createdAt.getTime()) ||
      typeof parsed.id !== 'string' ||
      !/^[0-9a-f-]{36}$/u.test(parsed.id)
    ) {
      throw new Error('invalid cursor');
    }

    return { createdAt, id: parsed.id };
  } catch {
    throw invalidCursorError();
  }
}

function assertPositiveVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Site version is invalid.',
      details: { field: 'version' },
    });
  }
}

function invalidCursorError(): DomainError {
  return new DomainError({
    code: ErrorCode.VALIDATION_FAILED,
    message: 'Site list cursor is invalid.',
    details: { field: 'cursor' },
  });
}

function siteNotFoundError(): DomainError {
  return new DomainError({
    code: ErrorCode.SITE_NOT_FOUND,
    message: 'Site was not found.',
  });
}

function versionConflictError(): DomainError {
  return new DomainError({
    code: ErrorCode.VERSION_CONFLICT,
    message: 'Site was changed by another request.',
  });
}
