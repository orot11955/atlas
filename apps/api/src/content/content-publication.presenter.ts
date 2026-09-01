import type {
  ContentPublicationRecord,
  ContentSiteRecord,
  DeliveryContentRecord,
} from '@atlas/server';

export function toContentSiteData(contentSite: Readonly<ContentSiteRecord>) {
  return {
    id: contentSite.id,
    contentId: contentSite.contentId,
    site: {
      id: contentSite.siteId,
      key: contentSite.siteKey,
      name: contentSite.siteName,
      status: contentSite.siteStatus,
    },
    slug: contentSite.slug,
    titleOverride: contentSite.titleOverride ?? null,
    summaryOverride: contentSite.summaryOverride ?? null,
    seo: contentSite.seo,
    visibility: contentSite.visibility,
    version: contentSite.version,
    activePublication: contentSite.activePublication
      ? {
          id: contentSite.activePublication.id,
          revisionId: contentSite.activePublication.revisionId,
          revisionNumber: contentSite.activePublication.revisionNumber,
          status: contentSite.activePublication.status,
          etag: contentSite.activePublication.etag,
          publishedAt: contentSite.activePublication.publishedAt.toISOString(),
        }
      : null,
    createdAt: contentSite.createdAt.toISOString(),
    updatedAt: contentSite.updatedAt.toISOString(),
  };
}

export function toContentPublicationData(publication: Readonly<ContentPublicationRecord>) {
  return {
    id: publication.id,
    contentSiteId: publication.contentSiteId,
    contentId: publication.contentId,
    contentType: publication.contentType,
    site: {
      id: publication.siteId,
      key: publication.siteKey,
      name: publication.siteName,
    },
    revisionId: publication.revisionId,
    revisionNumber: publication.revisionNumber,
    status: publication.status,
    slug: publication.slug,
    title: publication.title,
    summary: publication.summary ?? null,
    bodyHtml: publication.bodyHtml,
    assets: publication.assets.map(toPublicationAssetData),
    seo: publication.seo,
    visibility: publication.visibility,
    etag: publication.etag,
    publishedAt: publication.publishedAt.toISOString(),
    supersededAt: publication.supersededAt?.toISOString() ?? null,
    withdrawnAt: publication.withdrawnAt?.toISOString() ?? null,
    createdByAdminAccountId: publication.createdByAdminAccountId,
    createdAt: publication.createdAt.toISOString(),
  };
}

export function toDeliveryContentSummaryData(content: Readonly<DeliveryContentRecord>) {
  return {
    schemaVersion: content.schemaVersion,
    publicationId: content.publicationId,
    contentId: content.contentId,
    contentType: content.contentType,
    revisionNumber: content.revisionNumber,
    site: content.site,
    slug: content.slug,
    title: content.title,
    summary: content.summary ?? null,
    visibility: content.visibility,
    etag: content.etag,
    publishedAt: content.publishedAt.toISOString(),
  };
}

export function toDeliveryContentData(content: Readonly<DeliveryContentRecord>) {
  return {
    ...toDeliveryContentSummaryData(content),
    bodyHtml: content.bodyHtml,
    assets: content.assets.map(toPublicationAssetData),
    seo: content.seo,
  };
}

function toPublicationAssetData(asset: ContentPublicationRecord['assets'][number]) {
  return {
    assetId: asset.assetId,
    ordinal: asset.ordinal,
    kind: asset.kind,
    altText: asset.altText,
    caption: asset.caption ?? null,
    variants: asset.variants.map((variant) => ({
      key: variant.key,
      format: variant.format,
      contentType: variant.contentType,
      width: variant.width,
      height: variant.height,
      byteSize: variant.byteSize,
      sha256: variant.sha256,
      etag: variant.etag,
      publicUrl: variant.publicUrl,
    })),
  };
}
