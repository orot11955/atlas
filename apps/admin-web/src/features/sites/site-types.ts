export type SiteType = 'blog' | 'portfolio' | 'docs' | 'photo' | 'other';
export type SiteStatus = 'draft' | 'active' | 'maintenance' | 'disabled' | 'archived';
export type SiteDomainVerificationStatus = 'pending' | 'verified' | 'failed';

export interface Workspace {
  id: string;
  key: string;
  name: string;
  timezone: string;
  locale: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SiteCanonicalDomain {
  id: string;
  hostname: string;
  verificationStatus: SiteDomainVerificationStatus;
  verifiedAt?: string;
}

export interface Site {
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
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SiteListResult {
  items: readonly Site[];
  pageInfo: {
    nextCursor?: string;
  };
}

export interface ApiEnvelope<T> {
  data: T;
}

export const SITE_TYPE_OPTIONS: readonly Readonly<{
  value: SiteType;
  label: string;
}>[] = Object.freeze([
  { value: 'blog', label: 'Blog' },
  { value: 'portfolio', label: 'Portfolio' },
  { value: 'docs', label: 'Docs' },
  { value: 'photo', label: 'Photo' },
  { value: 'other', label: 'Other' },
]);

export const SITE_STATUS_OPTIONS: readonly Readonly<{
  value: SiteStatus;
  label: string;
}>[] = Object.freeze([
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'archived', label: 'Archived' },
]);

const STATUS_TRANSITIONS: Readonly<Record<SiteStatus, readonly SiteStatus[]>> =
  Object.freeze({
    draft: Object.freeze(['active', 'disabled', 'archived']),
    active: Object.freeze(['maintenance', 'disabled']),
    maintenance: Object.freeze(['active', 'disabled']),
    disabled: Object.freeze(['active', 'archived']),
    archived: Object.freeze([]),
  });

export function getSiteStatusTransitions(status: SiteStatus): readonly SiteStatus[] {
  return STATUS_TRANSITIONS[status];
}

export function siteStatusLabel(status: SiteStatus): string {
  return SITE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

export function siteTypeLabel(type: SiteType): string {
  return SITE_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}
