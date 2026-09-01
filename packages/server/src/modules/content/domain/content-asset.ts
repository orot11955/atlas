import { DomainError, ErrorCode } from '../../../core';
import {
  AssetKind,
  AssetStatus,
  type AssetKind as AssetKindType,
  type AssetStatus as AssetStatusType,
} from '../../media/domain/asset';
import {
  ASSET_IMAGE_VARIANT_SPECS,
  AssetVariantKey,
  type AssetVariantContentType,
  type AssetVariantFormat as AssetVariantFormatType,
  type AssetVariantKey as AssetVariantKeyType,
  type AssetVariantRecord,
} from '../../media/domain/asset-processing';
import { renderMarkdownPreview } from './content';

const UUID_PATTERN_SOURCE =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ASSET_IMAGE_PATTERN = new RegExp(
  String.raw`!\[([^\]\n]*)\]\(\s*asset:\/\/(${UUID_PATTERN_SOURCE})(?:\s+(?:"([^"\n]*)"|'([^'\n]*)'))?\s*\)`,
  'giu',
);
const ASSET_SCHEME_PATTERN = /asset:\/\//iu;
const MAX_CONTENT_ASSET_REFERENCES = 100;
const MAX_PUBLICATION_ASSET_MANIFEST_BYTES = 1_048_576;

export const AssetUsageKind = {
  INLINE: 'inline',
} as const;

export type AssetUsageKind = (typeof AssetUsageKind)[keyof typeof AssetUsageKind];

export interface ContentAssetReference {
  assetId: string;
  kind: AssetUsageKind;
  ordinal: number;
  altText: string;
  caption?: string;
}

export interface ContentAssetTargetRecord {
  id: string;
  kind: AssetKindType;
  status: AssetStatusType;
}

export interface AssetUsageRecord extends ContentAssetReference {
  id: string;
  workspaceId: string;
  revisionId: string;
  createdAt: Date;
}

export interface ContentAssetPublicationSourceRecord {
  usage: AssetUsageRecord;
  variants: readonly AssetVariantRecord[];
}

export interface ContentPublicationAssetVariantSnapshot {
  key: AssetVariantKeyType;
  format: AssetVariantFormatType;
  contentType: AssetVariantContentType;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
  etag: string;
  publicUrl: string;
}

export interface ContentPublicationAssetSnapshot extends ContentAssetReference {
  variants: readonly Readonly<ContentPublicationAssetVariantSnapshot>[];
}

interface ScannedContentAssetReference extends ContentAssetReference {
  start: number;
  end: number;
}

export function parseContentAssetReferences(
  bodyMarkdown: string,
): readonly Readonly<ContentAssetReference>[] {
  return Object.freeze(
    scanContentAssetReferences(bodyMarkdown).map(({ start: _start, end: _end, ...reference }) =>
      Object.freeze(reference),
    ),
  );
}

export function assertContentAssetReferencesReady(
  references: readonly Readonly<ContentAssetReference>[],
  targets: readonly Readonly<ContentAssetTargetRecord>[],
): void {
  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const referencedIds = [...new Set(references.map((reference) => reference.assetId))];
  const missingAssetIds = referencedIds.filter((assetId) => !targetsById.has(assetId));

  if (missingAssetIds.length > 0) {
    throw validationError(
      'bodyMarkdown',
      'Content references Assets that do not exist in this Workspace.',
      { assetIds: missingAssetIds },
    );
  }

  const unavailableAssetIds = referencedIds.filter((assetId) => {
    const target = targetsById.get(assetId);
    return target?.kind !== AssetKind.IMAGE || target.status !== AssetStatus.READY;
  });

  if (unavailableAssetIds.length > 0) {
    throw validationError('bodyMarkdown', 'Content references Assets that are not READY images.', {
      assetIds: unavailableAssetIds,
    });
  }
}

export function createContentPublicationAssetManifest(
  sources: readonly Readonly<ContentAssetPublicationSourceRecord>[],
  buildPublicUrl: (objectKey: string) => string,
): readonly Readonly<ContentPublicationAssetSnapshot>[] {
  if (sources.length > MAX_CONTENT_ASSET_REFERENCES) {
    throw validationError(
      'bodyMarkdown',
      `Content cannot reference more than ${MAX_CONTENT_ASSET_REFERENCES} Assets.`,
    );
  }

  const sortedSources = [...sources].sort(
    (left, right) => left.usage.ordinal - right.usage.ordinal,
  );
  const manifest = sortedSources.map((source, index) => {
    if (source.usage.ordinal !== index + 1) {
      throw publicationAssetStateError('Content Asset usage ordinals are not contiguous.');
    }

    const variantsByKey = new Map<AssetVariantKeyType, AssetVariantRecord>();

    for (const variant of source.variants) {
      if (
        variant.workspaceId !== source.usage.workspaceId ||
        variant.assetId !== source.usage.assetId ||
        variantsByKey.has(variant.key)
      ) {
        throw publicationAssetStateError('Content Asset variants are inconsistent.');
      }

      variantsByKey.set(variant.key, variant);
    }

    const variants = ASSET_IMAGE_VARIANT_SPECS.map((spec) => {
      const variant = variantsByKey.get(spec.key);

      if (!variant || variant.format !== spec.format) {
        throw publicationAssetStateError(
          `Content Asset is missing required Publication Variant ${spec.key}.`,
        );
      }

      return Object.freeze({
        key: variant.key,
        format: variant.format,
        contentType: variant.contentType,
        width: variant.width,
        height: variant.height,
        byteSize: variant.byteSize,
        sha256: variant.sha256,
        etag: variant.etag,
        publicUrl: normalizePublicAssetUrl(buildPublicUrl(variant.objectKey)),
      });
    });

    return Object.freeze({
      assetId: source.usage.assetId,
      kind: source.usage.kind,
      ordinal: source.usage.ordinal,
      altText: source.usage.altText,
      ...(source.usage.caption ? { caption: source.usage.caption } : {}),
      variants: Object.freeze(variants),
    });
  });

  if (Buffer.byteLength(JSON.stringify(manifest), 'utf8') > MAX_PUBLICATION_ASSET_MANIFEST_BYTES) {
    throw validationError(
      'bodyMarkdown',
      'Content Publication Asset Manifest cannot exceed 1 MiB.',
    );
  }

  return Object.freeze(manifest);
}

export function freezeContentPublicationAssetManifest(
  manifest: readonly Readonly<ContentPublicationAssetSnapshot>[],
): readonly Readonly<ContentPublicationAssetSnapshot>[] {
  return Object.freeze(
    manifest.map((entry) =>
      Object.freeze({
        ...entry,
        variants: Object.freeze(entry.variants.map((variant) => Object.freeze({ ...variant }))),
      }),
    ),
  );
}

export function renderContentPublicationBodyHtml(
  bodyMarkdown: string,
  manifest: readonly Readonly<ContentPublicationAssetSnapshot>[],
): string {
  const references = scanContentAssetReferences(bodyMarkdown);
  const manifestByOrdinal = new Map(manifest.map((entry) => [entry.ordinal, entry]));

  if (references.length !== manifest.length) {
    throw publicationAssetStateError(
      'Content Publication Asset Manifest does not match the READY Revision.',
    );
  }

  let cursor = 0;
  let rewrittenMarkdown = '';
  const replacements: { token: string; html: string }[] = [];

  for (const reference of references) {
    const entry = manifestByOrdinal.get(reference.ordinal);

    if (
      !entry ||
      entry.assetId !== reference.assetId ||
      entry.kind !== reference.kind ||
      entry.altText !== reference.altText ||
      entry.caption !== reference.caption
    ) {
      throw publicationAssetStateError(
        'Content Publication Asset Manifest does not match the READY Revision.',
      );
    }

    const token = `ATLASASSET${reference.ordinal}X${reference.assetId.replaceAll('-', '')}TOKEN`;

    if (bodyMarkdown.includes(token)) {
      throw publicationAssetStateError('Content contains a reserved Publication Asset token.');
    }

    rewrittenMarkdown += bodyMarkdown.slice(cursor, reference.start);
    rewrittenMarkdown += token;
    cursor = reference.end;
    replacements.push({ token, html: renderPublicationAssetPicture(entry) });
  }

  rewrittenMarkdown += bodyMarkdown.slice(cursor);
  let bodyHtml = renderMarkdownPreview(rewrittenMarkdown).html;

  for (const replacement of replacements) {
    bodyHtml = bodyHtml.replaceAll(replacement.token, replacement.html);
  }

  return bodyHtml;
}

function scanContentAssetReferences(bodyMarkdown: string): readonly ScannedContentAssetReference[] {
  const maskedMarkdown = maskCodeRanges(bodyMarkdown);
  const remaining = maskedMarkdown.split('');
  const references: ScannedContentAssetReference[] = [];

  for (const match of maskedMarkdown.matchAll(ASSET_IMAGE_PATTERN)) {
    const fullMatch = match[0];
    const start = match.index ?? 0;
    const assetId = normalizeAssetId(match[2] ?? '');
    const altText = normalizeAltText(match[1] ?? '');
    const caption = normalizeCaption(match[3] ?? match[4]);

    references.push({
      assetId,
      kind: AssetUsageKind.INLINE,
      ordinal: references.length + 1,
      altText,
      ...(caption ? { caption } : {}),
      start,
      end: start + fullMatch.length,
    });

    if (references.length > MAX_CONTENT_ASSET_REFERENCES) {
      throw validationError(
        'bodyMarkdown',
        `Content cannot reference more than ${MAX_CONTENT_ASSET_REFERENCES} Assets.`,
      );
    }

    for (let index = start; index < start + fullMatch.length; index += 1) {
      if (remaining[index] !== '\n') {
        remaining[index] = ' ';
      }
    }
  }

  if (ASSET_SCHEME_PATTERN.test(remaining.join(''))) {
    throw validationError(
      'bodyMarkdown',
      'Asset references must use Markdown image syntax: ![alt](asset://{assetId} "caption").',
    );
  }

  return references;
}

function renderPublicationAssetPicture(entry: Readonly<ContentPublicationAssetSnapshot>): string {
  const variantsByKey = new Map(entry.variants.map((variant) => [variant.key, variant]));
  const avif = requirePublicationVariant(variantsByKey, AssetVariantKey.AVIF_1920);
  const fallback = requirePublicationVariant(variantsByKey, AssetVariantKey.WEBP_1280);
  const webpVariants = [
    requirePublicationVariant(variantsByKey, AssetVariantKey.WEBP_320),
    requirePublicationVariant(variantsByKey, AssetVariantKey.WEBP_768),
    fallback,
  ];
  const webpByWidth = new Map<number, Readonly<ContentPublicationAssetVariantSnapshot>>();

  for (const variant of webpVariants) {
    webpByWidth.set(variant.width, variant);
  }

  const webpSrcset = [...webpByWidth.values()]
    .sort((left, right) => left.width - right.width)
    .map((variant) => `${escapeHtmlAttribute(variant.publicUrl)} ${variant.width}w`)
    .join(', ');
  const captionAttribute = entry.caption ? ` title="${escapeHtmlAttribute(entry.caption)}"` : '';

  return [
    `<picture data-asset-id="${escapeHtmlAttribute(entry.assetId)}">`,
    `<source type="${escapeHtmlAttribute(avif.contentType)}" srcset="${escapeHtmlAttribute(avif.publicUrl)}">`,
    `<source type="image/webp" srcset="${webpSrcset}" sizes="100vw">`,
    `<img src="${escapeHtmlAttribute(fallback.publicUrl)}" alt="${escapeHtmlAttribute(entry.altText)}" width="${fallback.width}" height="${fallback.height}" loading="lazy" decoding="async"${captionAttribute}>`,
    '</picture>',
  ].join('');
}

function requirePublicationVariant(
  variants: ReadonlyMap<AssetVariantKeyType, Readonly<ContentPublicationAssetVariantSnapshot>>,
  key: AssetVariantKeyType,
): Readonly<ContentPublicationAssetVariantSnapshot> {
  const variant = variants.get(key);

  if (!variant) {
    throw publicationAssetStateError(`Publication Asset Manifest is missing Variant ${key}.`);
  }

  return variant;
}

function normalizePublicAssetUrl(value: string): string {
  if (value.length < 1 || value.length > 4_096) {
    throw publicationAssetStateError('Public Asset URL is invalid.');
  }

  try {
    const url = new URL(value);

    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.hash
    ) {
      throw new Error('invalid public asset URL');
    }

    return url.toString();
  } catch {
    throw publicationAssetStateError('Public Asset URL is invalid.');
  }
}

function normalizeAssetId(value: string): string {
  const normalized = value.trim().toLowerCase();
  const pattern = new RegExp(`^${UUID_PATTERN_SOURCE}$`, 'u');

  if (!pattern.test(normalized)) {
    throw validationError('bodyMarkdown', 'Content contains an invalid Asset identifier.');
  }

  return normalized;
}

function normalizeAltText(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');

  if (normalized.length > 300) {
    throw validationError('bodyMarkdown', 'Asset alt text cannot exceed 300 characters.');
  }

  return normalized;
}

function normalizeCaption(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\s+/gu, ' ');

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > 1_000) {
    throw validationError('bodyMarkdown', 'Asset caption cannot exceed 1,000 characters.');
  }

  return normalized;
}

function maskCodeRanges(value: string): string {
  return value
    .replace(/```[\s\S]*?(?:```|$)/gu, maskNonNewlineCharacters)
    .replace(/`[^`\n]*`/gu, maskNonNewlineCharacters);
}

function maskNonNewlineCharacters(value: string): string {
  return value.replace(/[^\n]/gu, ' ');
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function publicationAssetStateError(message: string): DomainError {
  return new DomainError({
    code: ErrorCode.INVALID_STATE_TRANSITION,
    message,
  });
}

function validationError(
  field: string,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): DomainError {
  return new DomainError({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { field, ...details },
  });
}
