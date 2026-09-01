import { createHash } from 'node:crypto';

import { DomainError, ErrorCode } from '../../../core';
import type { ContentPublicationAssetSnapshot } from './content-asset';
import type { ContentRevisionRecord, ContentStatus, ContentType } from './content';
import { ContentRevisionKind, ContentStatus as ContentStatusValue } from './content';

export const ContentSiteVisibility = {
  PRIVATE: 'private',
  PUBLIC: 'public',
  UNLISTED: 'unlisted',
} as const;

export type ContentSiteVisibility =
  (typeof ContentSiteVisibility)[keyof typeof ContentSiteVisibility];

export const CONTENT_SITE_VISIBILITIES = Object.freeze(
  Object.values(ContentSiteVisibility),
) as readonly ContentSiteVisibility[];

export const ContentPublicationStatus = {
  ACTIVE: 'active',
  SUPERSEDED: 'superseded',
  WITHDRAWN: 'withdrawn',
} as const;

export type ContentPublicationStatus =
  (typeof ContentPublicationStatus)[keyof typeof ContentPublicationStatus];

export const CONTENT_PUBLICATION_STATUSES = Object.freeze(
  Object.values(ContentPublicationStatus),
) as readonly ContentPublicationStatus[];

export const CONTENT_DELIVERY_SCHEMA_VERSION = 1 as const;

export interface ContentSiteRecord {
  id: string;
  workspaceId: string;
  contentId: string;
  siteId: string;
  siteKey: string;
  siteName: string;
  siteStatus: string;
  slug: string;
  titleOverride?: string;
  summaryOverride?: string;
  seo: Readonly<Record<string, unknown>>;
  visibility: ContentSiteVisibility;
  version: number;
  activePublication?: ContentPublicationSummaryRecord;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentPublicationSummaryRecord {
  id: string;
  revisionId: string;
  revisionNumber: number;
  status: ContentPublicationStatus;
  etag: string;
  publishedAt: Date;
}

export interface ContentPublicationRecord extends ContentPublicationSummaryRecord {
  workspaceId: string;
  contentSiteId: string;
  contentId: string;
  contentType: ContentType;
  siteId: string;
  siteKey: string;
  siteName: string;
  slug: string;
  title: string;
  summary?: string;
  bodyHtml: string;
  assets: readonly Readonly<ContentPublicationAssetSnapshot>[];
  seo: Readonly<Record<string, unknown>>;
  visibility: ContentSiteVisibility;
  supersededAt?: Date;
  withdrawnAt?: Date;
  createdByAdminAccountId: string;
  createdAt: Date;
}

export interface PublishableContentRecord {
  id: string;
  workspaceId: string;
  type: ContentType;
  status: ContentStatus;
  readyRevisionNumber?: number;
  revision?: ContentRevisionRecord;
}

export interface ContentSiteTargetRecord {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  status: string;
}

export interface ContentPublicationSnapshot {
  contentId: string;
  contentType: ContentType;
  siteId: string;
  siteKey: string;
  siteName: string;
  revisionId: string;
  revisionNumber: number;
  slug: string;
  title: string;
  summary?: string;
  bodyHtml: string;
  assets: readonly Readonly<ContentPublicationAssetSnapshot>[];
  seo: Readonly<Record<string, unknown>>;
  visibility: ContentSiteVisibility;
}

export interface DeliveryContentRecord {
  schemaVersion: typeof CONTENT_DELIVERY_SCHEMA_VERSION;
  publicationId: string;
  contentId: string;
  contentType: ContentType;
  revisionNumber: number;
  site: Readonly<{
    id: string;
    key: string;
    name: string;
  }>;
  slug: string;
  title: string;
  summary?: string;
  bodyHtml: string;
  assets: readonly Readonly<ContentPublicationAssetSnapshot>[];
  seo: Readonly<Record<string, unknown>>;
  visibility: ContentSiteVisibility;
  etag: string;
  publishedAt: Date;
}

export function normalizeContentSiteSlug(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (
    normalized.length < 1 ||
    normalized.length > 160 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalized)
  ) {
    throw validationError(
      'slug',
      'Content Site slug must contain lowercase letters, numbers and single hyphens.',
    );
  }

  return normalized;
}

export function normalizeContentSiteTitleOverride(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\s+/gu, ' ');

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > 200) {
    throw validationError(
      'titleOverride',
      'Content Site title override cannot exceed 200 characters.',
    );
  }

  return normalized;
}

export function normalizeContentSiteSummaryOverride(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\s+/gu, ' ');

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > 500) {
    throw validationError(
      'summaryOverride',
      'Content Site summary override cannot exceed 500 characters.',
    );
  }

  return normalized;
}

export function normalizeContentSiteVisibility(value: string): ContentSiteVisibility {
  if (!CONTENT_SITE_VISIBILITIES.includes(value as ContentSiteVisibility)) {
    throw validationError('visibility', 'Content Site visibility is invalid.');
  }

  return value as ContentSiteVisibility;
}

export function normalizeContentSiteSeo(
  value?: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (value === undefined) {
    return Object.freeze({});
  }

  if (!isPlainObject(value)) {
    throw validationError('seo', 'Content Site SEO must be a JSON object.');
  }

  let normalized: unknown;

  try {
    normalized = normalizeJsonValue(value, 0);
  } catch (error) {
    throw validationError('seo', readErrorMessage(error, 'Content Site SEO is invalid.'));
  }

  if (!isPlainObject(normalized)) {
    throw validationError('seo', 'Content Site SEO must be a JSON object.');
  }

  const serialized = JSON.stringify(normalized);

  if (Buffer.byteLength(serialized, 'utf8') > 16_384) {
    throw validationError('seo', 'Content Site SEO cannot exceed 16 KiB.');
  }

  return deepFreezeJsonObject(normalized);
}

export function assertContentCanReceiveSite(status: ContentStatus): void {
  if (status === ContentStatusValue.ARCHIVED) {
    throw new DomainError({
      code: ErrorCode.ACTION_NOT_ALLOWED,
      message: 'Archived Content cannot be assigned to a Site.',
    });
  }
}

export function assertSiteCanReceiveContent(status: string): void {
  if (status === 'archived') {
    throw new DomainError({
      code: ErrorCode.ACTION_NOT_ALLOWED,
      message: 'Archived Sites cannot receive Content.',
    });
  }
}

export function assertContentPublishable(content: PublishableContentRecord): ContentRevisionRecord {
  if (content.status === ContentStatusValue.ARCHIVED) {
    throw new DomainError({
      code: ErrorCode.ACTION_NOT_ALLOWED,
      message: 'Archived Content cannot be published.',
    });
  }

  if (
    !content.readyRevisionNumber ||
    !content.revision ||
    content.revision.kind !== ContentRevisionKind.READY ||
    content.revision.revisionNumber !== content.readyRevisionNumber
  ) {
    throw new DomainError({
      code: ErrorCode.INVALID_STATE_TRANSITION,
      message: 'The current READY Revision is required before publishing Content.',
    });
  }

  return content.revision;
}

export function assertSitePublishable(status: string): void {
  if (status !== 'active') {
    throw new DomainError({
      code: ErrorCode.INVALID_STATE_TRANSITION,
      message: 'Only an active Site can publish Content.',
      details: { siteStatus: status },
    });
  }
}

export function createContentPublicationSnapshot(
  contentType: ContentType,
  contentSite: Pick<
    ContentSiteRecord,
    | 'contentId'
    | 'siteId'
    | 'siteKey'
    | 'siteName'
    | 'slug'
    | 'titleOverride'
    | 'summaryOverride'
    | 'seo'
    | 'visibility'
  >,
  revision: ContentRevisionRecord,
  rendering: Readonly<{
    bodyHtml?: string;
    assets?: readonly Readonly<ContentPublicationAssetSnapshot>[];
  }> = {},
): Readonly<ContentPublicationSnapshot> {
  const title = contentSite.titleOverride ?? revision.title;

  if (!title) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Published Content must have a title.',
      details: { field: 'title' },
    });
  }

  return Object.freeze({
    contentId: contentSite.contentId,
    contentType,
    siteId: contentSite.siteId,
    siteKey: contentSite.siteKey,
    siteName: contentSite.siteName,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    slug: contentSite.slug,
    title,
    ...((contentSite.summaryOverride ?? revision.summary)
      ? { summary: contentSite.summaryOverride ?? revision.summary }
      : {}),
    bodyHtml: rendering.bodyHtml ?? revision.bodyHtml,
    assets: rendering.assets ?? Object.freeze([]),
    seo: contentSite.seo,
    visibility: contentSite.visibility,
  });
}

export function createContentPublicationEtag(snapshot: ContentPublicationSnapshot): string {
  const canonical = stableSerialize({
    schemaVersion: CONTENT_DELIVERY_SCHEMA_VERSION,
    contentId: snapshot.contentId,
    contentType: snapshot.contentType,
    siteId: snapshot.siteId,
    siteKey: snapshot.siteKey,
    siteName: snapshot.siteName,
    revisionId: snapshot.revisionId,
    revisionNumber: snapshot.revisionNumber,
    slug: snapshot.slug,
    title: snapshot.title,
    summary: snapshot.summary ?? null,
    bodyHtml: snapshot.bodyHtml,
    assets: snapshot.assets,
    seo: snapshot.seo,
    visibility: snapshot.visibility,
  });

  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function isSamePublicationSnapshot(
  publication: Pick<ContentPublicationRecord, 'etag'>,
  snapshot: ContentPublicationSnapshot,
): boolean {
  return publication.etag === createContentPublicationEtag(snapshot);
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    );
  }

  return value;
}

function normalizeJsonValue(value: unknown, depth: number): unknown {
  if (depth > 12) {
    throw new Error('Content Site SEO cannot exceed 12 nested levels.');
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Content Site SEO numbers must be finite.');
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length > 100) {
      throw new Error('Content Site SEO arrays cannot contain more than 100 values.');
    }
    return value.map((entry) => normalizeJsonValue(entry, depth + 1));
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);

    if (entries.length > 100) {
      throw new Error('Content Site SEO objects cannot contain more than 100 keys.');
    }

    return Object.fromEntries(
      entries.map(([key, entry]) => {
        if (!key || key.length > 120) {
          throw new Error('Content Site SEO keys must contain between 1 and 120 characters.');
        }
        return [key, normalizeJsonValue(entry, depth + 1)];
      }),
    );
  }

  throw new Error('Content Site SEO contains a non-JSON value.');
}

function deepFreezeJsonObject(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  for (const entry of Object.values(value)) {
    if (Array.isArray(entry)) {
      deepFreezeJsonArray(entry);
    } else if (isPlainObject(entry)) {
      deepFreezeJsonObject(entry);
    }
  }

  return Object.freeze(value);
}

function deepFreezeJsonArray(value: readonly unknown[]): readonly unknown[] {
  for (const entry of value) {
    if (Array.isArray(entry)) {
      deepFreezeJsonArray(entry);
    } else if (isPlainObject(entry)) {
      deepFreezeJsonObject(entry);
    }
  }

  return Object.freeze(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validationError(field: string, message: string): DomainError {
  return new DomainError({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { field },
  });
}

function readErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
