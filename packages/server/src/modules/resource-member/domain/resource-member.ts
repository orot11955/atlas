import { DomainError, ErrorCode } from '../../../core';

export const ResourceCollectionStatus = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
} as const;
export type ResourceCollectionStatus =
  (typeof ResourceCollectionStatus)[keyof typeof ResourceCollectionStatus];

export const ResourceType = {
  NOTE: 'note',
  DOCUMENT: 'document',
  LINK: 'link',
  REFERENCE: 'reference',
  CHECKLIST: 'checklist',
  SNIPPET: 'snippet',
} as const;
export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType];
export const RESOURCE_TYPES = Object.freeze(Object.values(ResourceType)) as readonly ResourceType[];

export const ResourceVisibility = {
  PRIVATE: 'private',
  WORKSPACE: 'workspace',
} as const;
export type ResourceVisibility =
  (typeof ResourceVisibility)[keyof typeof ResourceVisibility];
export const RESOURCE_VISIBILITIES = Object.freeze(
  Object.values(ResourceVisibility),
) as readonly ResourceVisibility[];

export const ResourceSensitivity = {
  NORMAL: 'normal',
  SENSITIVE: 'sensitive',
} as const;
export type ResourceSensitivity =
  (typeof ResourceSensitivity)[keyof typeof ResourceSensitivity];
export const RESOURCE_SENSITIVITIES = Object.freeze(
  Object.values(ResourceSensitivity),
) as readonly ResourceSensitivity[];

export const ResourceStatus = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
} as const;
export type ResourceStatus = (typeof ResourceStatus)[keyof typeof ResourceStatus];
export const RESOURCE_STATUSES = Object.freeze(
  Object.values(ResourceStatus),
) as readonly ResourceStatus[];

export const ResourceRelationTargetType = {
  PROJECT: 'project',
  CONTENT: 'content',
  RESOURCE: 'resource',
} as const;
export type ResourceRelationTargetType =
  (typeof ResourceRelationTargetType)[keyof typeof ResourceRelationTargetType];

export const ResourceRelationType = {
  RELATED_TO: 'related-to',
  IMPLEMENTS: 'implements',
  REFERENCES: 'references',
  DERIVED_FROM: 'derived-from',
} as const;
export type ResourceRelationType =
  (typeof ResourceRelationType)[keyof typeof ResourceRelationType];

export const MemberStatus = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
} as const;
export type MemberStatus = (typeof MemberStatus)[keyof typeof MemberStatus];
export const MEMBER_STATUSES = Object.freeze(Object.values(MemberStatus)) as readonly MemberStatus[];

export const SiteMembershipStatus = {
  PENDING: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  WITHDRAWN: 'withdrawn',
} as const;
export type SiteMembershipStatus =
  (typeof SiteMembershipStatus)[keyof typeof SiteMembershipStatus];
export const SITE_MEMBERSHIP_STATUSES = Object.freeze(
  Object.values(SiteMembershipStatus),
) as readonly SiteMembershipStatus[];

export interface ResourceCollectionRecord {
  id: string;
  workspaceId: string;
  parentId?: string;
  name: string;
  normalizedName: string;
  description?: string;
  status: ResourceCollectionStatus;
  version: number;
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResourceRecord {
  id: string;
  workspaceId: string;
  collectionId?: string;
  type: ResourceType;
  title: string;
  summary?: string;
  bodyMarkdown?: string;
  sourceUrl?: string;
  visibility: ResourceVisibility;
  sensitivity: ResourceSensitivity;
  secretReference?: string;
  status: ResourceStatus;
  version: number;
  tags: readonly string[];
  projectIds: readonly string[];
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SiteMembershipRecord {
  memberId: string;
  siteId: string;
  workspaceId: string;
  status: SiteMembershipStatus;
  version: number;
  joinedAt?: Date;
  updatedAt: Date;
}

export interface MemberAdminNoteRecord {
  id: string;
  workspaceId: string;
  memberId: string;
  body: string;
  createdByAdminAccountId: string;
  createdAt: Date;
}

export interface MemberRecord {
  id: string;
  workspaceId: string;
  email?: string;
  normalizedEmail?: string;
  displayName: string;
  externalProvider?: string;
  externalSubject?: string;
  status: MemberStatus;
  version: number;
  memberships: readonly SiteMembershipRecord[];
  notes: readonly MemberAdminNoteRecord[];
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SECRET_PATTERNS: readonly RegExp[] = Object.freeze([
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/iu,
  /\b(?:password|passwd|pwd|api[_-]?key|access[_-]?token|client[_-]?secret|secret)\s*[:=]\s*[^\s]{6,}/iu,
  /\batlas_(?:live|test)_[A-Za-z0-9._-]{20,}/u,
  /\bgh[opusr]_[A-Za-z0-9]{20,}/u,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
]);

export function normalizeResourceCollectionName(value: string): Readonly<{
  name: string;
  normalizedName: string;
}> {
  const name = normalizeText(value, 1, 120, 'name');
  return Object.freeze({ name, normalizedName: name.toLocaleLowerCase('en-US') });
}

export function normalizeResourceTitle(value: string): string {
  return normalizeText(value, 1, 200, 'title');
}

export function normalizeMemberDisplayName(value: string): string {
  return normalizeText(value, 1, 120, 'displayName');
}

export function normalizeOptionalText(
  value: string | undefined,
  maximum: number,
  field: string,
): string | undefined {
  const normalized = value?.trim().replace(/\s+/gu, ' ');
  if (!normalized) return undefined;
  if (normalized.length > maximum) throw validationError(field, `${field} is too long.`);
  return normalized;
}

export function normalizeMarkdown(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\r\n?/gu, '\n').trim();
  if (!normalized) return undefined;
  if (normalized.length > 200_000) {
    throw validationError('bodyMarkdown', 'Resource Markdown cannot exceed 200,000 characters.');
  }
  return normalized;
}

export function normalizeResourceSourceUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > 2_000) throw validationError('sourceUrl', 'Source URL is too long.');
  try {
    const url = new URL(normalized);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('invalid URL');
    }
    return url.toString();
  } catch {
    throw validationError('sourceUrl', 'Source URL must be an HTTP or HTTPS URL without credentials.');
  }
}

export function normalizeSecretReference(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (!/^secret:\/\/[A-Za-z0-9][A-Za-z0-9/_-]{2,255}$/u.test(normalized)) {
    throw validationError(
      'secretReference',
      'Secret reference must use secret:// and contain only a safe reference path.',
    );
  }
  return normalized;
}

export function normalizeResourceTags(values: readonly string[] | undefined): readonly string[] {
  const normalized = [...new Set((values ?? []).map((value) =>
    normalizeText(value, 1, 64, 'tags').toLocaleLowerCase('en-US'),
  ))].sort();
  if (normalized.length > 30) throw validationError('tags', 'A Resource can contain at most 30 tags.');
  return Object.freeze(normalized);
}

export function normalizeUuidList(values: readonly string[] | undefined, field: string): readonly string[] {
  const normalized = [...new Set(values ?? [])].sort();
  if (normalized.length > 100) throw validationError(field, `${field} contains too many values.`);
  if (normalized.some((value) => !isUuid(value))) {
    throw validationError(field, `${field} must contain UUID values.`);
  }
  return Object.freeze(normalized);
}

export function normalizeEmail(value: string | undefined): Readonly<{
  email?: string;
  normalizedEmail?: string;
}> {
  const email = value?.trim();
  if (!email) return Object.freeze({});
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw validationError('email', 'Member email is invalid.');
  }
  return Object.freeze({ email, normalizedEmail: email.toLocaleLowerCase('en-US') });
}

export function normalizeExternalIdentity(
  provider: string | undefined,
  subject: string | undefined,
): Readonly<{ provider?: string; subject?: string }> {
  const normalizedProvider = provider?.trim().toLocaleLowerCase('en-US');
  const normalizedSubject = subject?.trim();
  if (!normalizedProvider && !normalizedSubject) return Object.freeze({});
  if (!normalizedProvider || !normalizedSubject) {
    throw validationError(
      'externalIdentity',
      'External provider and subject must be supplied together.',
    );
  }
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/u.test(normalizedProvider)) {
    throw validationError('externalProvider', 'External provider is invalid.');
  }
  if (normalizedSubject.length > 240 || /[\u0000-\u001f\u007f]/u.test(normalizedSubject)) {
    throw validationError('externalSubject', 'External subject is invalid.');
  }
  return Object.freeze({ provider: normalizedProvider, subject: normalizedSubject });
}

export function assertResourceContent(
  type: ResourceType,
  bodyMarkdown: string | undefined,
  sourceUrl: string | undefined,
): void {
  if (type === ResourceType.LINK && !sourceUrl) {
    throw validationError('sourceUrl', 'Link Resources require a source URL.');
  }
  if (type !== ResourceType.LINK && !bodyMarkdown && !sourceUrl) {
    throw validationError(
      'bodyMarkdown',
      'Resource requires Markdown content or a source URL.',
    );
  }
}

export function assertNoLikelySecret(values: readonly (string | undefined)[]): void {
  const candidate = values.filter((value): value is string => Boolean(value)).join('\n');
  if (SECRET_PATTERNS.some((pattern) => pattern.test(candidate))) {
    throw new DomainError({
      code: ErrorCode.RESOURCE_SECRET_DETECTED,
      message:
        'A likely credential was detected. Store the secret in a Secret Store and save only a secret:// reference.',
    });
  }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function normalizeText(value: string, minimum: number, maximum: number, field: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length < minimum || normalized.length > maximum) {
    throw validationError(field, `${field} must contain between ${minimum} and ${maximum} characters.`);
  }
  return normalized;
}

function validationError(field: string, message: string): DomainError {
  return new DomainError({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { field },
  });
}
