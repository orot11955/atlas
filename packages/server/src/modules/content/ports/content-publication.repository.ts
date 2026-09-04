import type { ContentStatus, ContentType } from '../domain/content';
import type {
  ContentPublicationRecord,
  ContentPublicationStatus,
  ContentSiteRecord,
  ContentSiteTargetRecord,
  ContentSiteVisibility,
  DeliveryContentRecord,
  PublishableContentRecord,
} from '../domain/content-publication';

export interface InsertContentSiteInput {
  id: string;
  workspaceId: string;
  contentId: string;
  siteId: string;
  slug: string;
  titleOverride?: string;
  summaryOverride?: string;
  seo: Readonly<Record<string, unknown>>;
  visibility: ContentSiteVisibility;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateContentSiteRecordInput {
  expectedVersion: number;
  nextVersion: number;
  slug: string;
  titleOverride?: string;
  summaryOverride?: string;
  seo: Readonly<Record<string, unknown>>;
  visibility: ContentSiteVisibility;
  updatedAt: Date;
}

export interface InsertContentPublicationInput {
  id: string;
  workspaceId: string;
  contentSiteId: string;
  contentId: string;
  contentType: ContentType;
  siteId: string;
  siteKey: string;
  siteName: string;
  revisionId: string;
  revisionNumber: number;
  status: ContentPublicationStatus;
  slug: string;
  title: string;
  summary?: string;
  bodyHtml: string;
  assets: ContentPublicationRecord['assets'];
  seo: Readonly<Record<string, unknown>>;
  visibility: ContentSiteVisibility;
  etag: string;
  publishedAt: Date;
  createdByAdminAccountId: string;
  createdAt: Date;
}

export interface DeliveryContentCursor {
  publishedAt: Date;
  id: string;
}

export interface DeliveryContentRepositoryListQuery {
  limit: number;
  cursor?: DeliveryContentCursor;
  contentType?: ContentType;
}

export interface ContentPublicationRepositoryPort<TTransaction = unknown> {
  listContentSites(workspaceId: string, contentId: string): Promise<readonly ContentSiteRecord[]>;
  findContentSite(
    workspaceId: string,
    contentId: string,
    contentSiteId: string,
    transaction?: TTransaction,
  ): Promise<ContentSiteRecord | undefined>;
  findContentSiteForUpdate(
    workspaceId: string,
    contentId: string,
    contentSiteId: string,
    transaction: TTransaction,
  ): Promise<ContentSiteRecord | undefined>;
  findContentStatus(
    workspaceId: string,
    contentId: string,
    transaction?: TTransaction,
  ): Promise<ContentStatus | undefined>;
  findSiteTarget(
    workspaceId: string,
    siteId: string,
    transaction?: TTransaction,
  ): Promise<ContentSiteTargetRecord | undefined>;
  insertContentSite(input: InsertContentSiteInput, transaction: TTransaction): Promise<void>;
  updateContentSite(
    workspaceId: string,
    contentId: string,
    contentSiteId: string,
    input: UpdateContentSiteRecordInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  findPublishableContentForUpdate(
    workspaceId: string,
    contentId: string,
    transaction: TTransaction,
  ): Promise<PublishableContentRecord | undefined>;
  findPublishableRevisionForUpdate(
    workspaceId: string,
    contentId: string,
    revisionId: string,
    transaction: TTransaction,
  ): Promise<PublishableContentRecord | undefined>;
  findActivePublication(
    workspaceId: string,
    contentSiteId: string,
    transaction?: TTransaction,
  ): Promise<ContentPublicationRecord | undefined>;
  findActiveSlugOwner(
    workspaceId: string,
    siteId: string,
    slug: string,
    transaction: TTransaction,
  ): Promise<string | undefined>;
  supersedeActivePublication(
    workspaceId: string,
    contentSiteId: string,
    supersededAt: Date,
    transaction: TTransaction,
  ): Promise<void>;
  insertPublication(input: InsertContentPublicationInput, transaction: TTransaction): Promise<void>;
  withdrawActivePublication(
    workspaceId: string,
    contentSiteId: string,
    withdrawnAt: Date,
    transaction: TTransaction,
  ): Promise<boolean>;
  listPublications(
    workspaceId: string,
    contentSiteId: string,
  ): Promise<readonly ContentPublicationRecord[]>;
  findPublication(
    workspaceId: string,
    contentSiteId: string,
    publicationId: string,
    transaction?: TTransaction,
  ): Promise<ContentPublicationRecord | undefined>;
  listDeliveryContent(
    workspaceId: string,
    siteId: string,
    query: DeliveryContentRepositoryListQuery,
  ): Promise<readonly DeliveryContentRecord[]>;
  findDeliveryContentBySlug(
    workspaceId: string,
    siteId: string,
    slug: string,
    contentType?: ContentType,
  ): Promise<DeliveryContentRecord | undefined>;
}
