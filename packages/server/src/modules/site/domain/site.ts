import { domainToASCII } from 'node:url';

import { DomainError, ErrorCode } from '../../../core';
import {
  normalizeWorkspaceLocale,
  normalizeWorkspaceTimezone,
} from '../../workspace/domain/workspace';

export const SiteType = {
  BLOG: 'blog',
  DOCS: 'docs',
  OTHER: 'other',
  PHOTO: 'photo',
  PORTFOLIO: 'portfolio',
} as const;

export type SiteType = (typeof SiteType)[keyof typeof SiteType];

export const SITE_TYPES = Object.freeze(Object.values(SiteType)) as readonly SiteType[];

export const SiteStatus = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  DISABLED: 'disabled',
  DRAFT: 'draft',
  MAINTENANCE: 'maintenance',
} as const;

export type SiteStatus = (typeof SiteStatus)[keyof typeof SiteStatus];

export const SITE_STATUSES = Object.freeze(
  Object.values(SiteStatus),
) as readonly SiteStatus[];

export const SiteDomainVerificationStatus = {
  FAILED: 'failed',
  PENDING: 'pending',
  VERIFIED: 'verified',
} as const;

export type SiteDomainVerificationStatus =
  (typeof SiteDomainVerificationStatus)[keyof typeof SiteDomainVerificationStatus];

export interface SiteCanonicalDomain {
  id: string;
  hostname: string;
  verificationStatus: SiteDomainVerificationStatus;
  verifiedAt?: Date;
}

export interface SiteRecord {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  description?: string;
  type: SiteType;
  status: SiteStatus;
  timezone: string;
  locale: string;
  version: number;
  canonicalDomain?: SiteCanonicalDomain;
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSiteDetails {
  key: string;
  name: string;
  description?: string;
  type: SiteType;
  timezone: string;
  locale: string;
  canonicalDomain?: string;
}

export interface UpdateSiteDetails {
  name: string;
  description?: string;
  type: SiteType;
  timezone: string;
  locale: string;
  canonicalDomain?: string;
}

const STATUS_TRANSITIONS: Readonly<Record<SiteStatus, readonly SiteStatus[]>> =
  Object.freeze({
    [SiteStatus.DRAFT]: Object.freeze([
      SiteStatus.ACTIVE,
      SiteStatus.DISABLED,
      SiteStatus.ARCHIVED,
    ]),
    [SiteStatus.ACTIVE]: Object.freeze([
      SiteStatus.MAINTENANCE,
      SiteStatus.DISABLED,
    ]),
    [SiteStatus.MAINTENANCE]: Object.freeze([
      SiteStatus.ACTIVE,
      SiteStatus.DISABLED,
    ]),
    [SiteStatus.DISABLED]: Object.freeze([
      SiteStatus.ACTIVE,
      SiteStatus.ARCHIVED,
    ]),
    [SiteStatus.ARCHIVED]: Object.freeze([]),
  });

export function normalizeSiteKey(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (
    normalized.length < 2 ||
    normalized.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalized)
  ) {
    throw validationError(
      'key',
      'Site key must be a lowercase letter, number and hyphen identifier.',
    );
  }

  return normalized;
}

export function normalizeSiteName(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');

  if (normalized.length < 1 || normalized.length > 120) {
    throw validationError('name', 'Site name must contain between 1 and 120 characters.');
  }

  return normalized;
}

export function normalizeSiteDescription(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\s+/gu, ' ');

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > 500) {
    throw validationError('description', 'Site description cannot exceed 500 characters.');
  }

  return normalized;
}

export function normalizeSiteType(value: string): SiteType {
  if (!SITE_TYPES.includes(value as SiteType)) {
    throw validationError('type', 'Site type is invalid.');
  }

  return value as SiteType;
}

export function normalizeSiteTimezone(value: string): string {
  try {
    return normalizeWorkspaceTimezone(value);
  } catch (error) {
    throw validationError('timezone', readMessage(error, 'Site timezone is invalid.'));
  }
}

export function normalizeSiteLocale(value: string): string {
  try {
    return normalizeWorkspaceLocale(value);
  } catch (error) {
    throw validationError('locale', readMessage(error, 'Site locale is invalid.'));
  }
}

export function normalizeCanonicalHostname(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase().replace(/\.$/u, '');

  if (!normalized) {
    return undefined;
  }

  if (
    normalized.includes('://') ||
    normalized.includes('/') ||
    normalized.includes('?') ||
    normalized.includes('#') ||
    normalized.includes(':')
  ) {
    throw validationError('canonicalDomain', 'Canonical domain must contain only a hostname.');
  }

  const ascii = domainToASCII(normalized);
  const labels = ascii.split('.');

  if (
    !ascii ||
    ascii.length > 253 ||
    labels.length < 2 ||
    labels.some(
      (label) =>
        label.length < 1 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    )
  ) {
    throw validationError('canonicalDomain', 'Canonical domain is invalid.');
  }

  return ascii;
}

export function assertSiteEditable(status: SiteStatus): void {
  if (status === SiteStatus.ARCHIVED) {
    throw new DomainError({
      code: ErrorCode.ACTION_NOT_ALLOWED,
      message: 'Archived Sites cannot be modified.',
    });
  }
}

export function assertSiteStatusTransition(
  current: SiteStatus,
  target: SiteStatus,
): void {
  if (current === target) {
    return;
  }

  if (!STATUS_TRANSITIONS[current].includes(target)) {
    throw new DomainError({
      code: ErrorCode.INVALID_STATE_TRANSITION,
      message: `Site status cannot change from ${current} to ${target}.`,
      details: { current, target },
    });
  }
}

function validationError(field: string, message: string): DomainError {
  return new DomainError({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { field },
  });
}

function readMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
