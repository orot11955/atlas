import { DomainError, ErrorCode } from '../../../core';
import {
  AssetKind,
  AssetStatus,
  type AssetKind as AssetKindType,
  type AssetStatus as AssetStatusType,
} from '../../media/domain/asset';

const UUID_PATTERN_SOURCE =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ASSET_IMAGE_PATTERN = new RegExp(
  String.raw`!\[([^\]\n]*)\]\(\s*asset:\/\/(${UUID_PATTERN_SOURCE})(?:\s+(?:"([^"\n]*)"|'([^'\n]*)'))?\s*\)`,
  'giu',
);
const ASSET_SCHEME_PATTERN = /asset:\/\//iu;

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

export function parseContentAssetReferences(
  bodyMarkdown: string,
): readonly Readonly<ContentAssetReference>[] {
  const maskedMarkdown = maskCodeRanges(bodyMarkdown);
  const remaining = maskedMarkdown.split('');
  const references: ContentAssetReference[] = [];

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
    });

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

  return Object.freeze(references.map((reference) => Object.freeze(reference)));
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
