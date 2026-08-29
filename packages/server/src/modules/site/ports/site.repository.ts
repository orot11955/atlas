import type { SiteCanonicalDomain, SiteRecord, SiteStatus, SiteType } from '../domain/site';

export interface SiteListCursor {
  createdAt: Date;
  id: string;
}

export interface SiteListRepositoryQuery {
  limit: number;
  cursor?: SiteListCursor;
  status?: SiteStatus;
  type?: SiteType;
  search?: string;
}

export interface InsertSiteRecordInput extends Omit<SiteRecord, 'canonicalDomain'> {
  canonicalDomain?: SiteCanonicalDomain;
}

export interface UpdateSiteRecordInput {
  name: string;
  description?: string;
  type: SiteType;
  timezone: string;
  locale: string;
  expectedVersion: number;
  nextVersion: number;
  updatedAt: Date;
}

export interface UpdateSiteStatusRecordInput {
  status: SiteStatus;
  expectedVersion: number;
  nextVersion: number;
  archivedAt?: Date;
  updatedAt: Date;
}

export interface SiteRepositoryPort<TTransaction = unknown> {
  list(workspaceId: string, query: SiteListRepositoryQuery): Promise<readonly SiteRecord[]>;
  findById(
    workspaceId: string,
    siteId: string,
    transaction?: TTransaction,
  ): Promise<SiteRecord | undefined>;
  findByKey(
    workspaceId: string,
    key: string,
    transaction?: TTransaction,
  ): Promise<SiteRecord | undefined>;
  findCanonicalDomainOwner(
    workspaceId: string,
    hostname: string,
    transaction?: TTransaction,
  ): Promise<string | undefined>;
  insert(site: InsertSiteRecordInput, transaction: TTransaction): Promise<void>;
  update(
    workspaceId: string,
    siteId: string,
    input: UpdateSiteRecordInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  replaceCanonicalDomain(
    workspaceId: string,
    siteId: string,
    domain: SiteCanonicalDomain | undefined,
    updatedAt: Date,
    transaction: TTransaction,
  ): Promise<void>;
  updateStatus(
    workspaceId: string,
    siteId: string,
    input: UpdateSiteStatusRecordInput,
    transaction: TTransaction,
  ): Promise<boolean>;
}
