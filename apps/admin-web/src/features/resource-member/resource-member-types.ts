export type ResourceType = 'note' | 'document' | 'link' | 'reference' | 'checklist' | 'snippet';
export type ResourceVisibility = 'private' | 'workspace';
export type ResourceSensitivity = 'normal' | 'sensitive';
export type ResourceStatus = 'active' | 'archived';
export type MemberStatus = 'active' | 'archived';
export type SiteMembershipStatus = 'pending' | 'active' | 'suspended' | 'withdrawn';

export interface ResourceCollection {
  id: string;
  workspaceId: string;
  parentId?: string;
  name: string;
  description?: string;
  status: 'active' | 'archived';
  version: number;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Resource {
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
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SiteMembership {
  memberId: string;
  siteId: string;
  status: SiteMembershipStatus;
  version: number;
  joinedAt?: string;
  updatedAt: string;
}

export interface MemberAdminNote {
  id: string;
  body: string;
  createdByAdminAccountId: string;
  createdAt: string;
}

export interface Member {
  id: string;
  workspaceId: string;
  email?: string;
  displayName: string;
  externalProvider?: string;
  externalSubject?: string;
  status: MemberStatus;
  version: number;
  memberships: readonly SiteMembership[];
  notes: readonly MemberAdminNote[];
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiEnvelope<T> {
  data: T;
}

export const RESOURCE_TYPE_OPTIONS: readonly Readonly<{
  value: ResourceType;
  label: string;
}>[] = [
  { value: 'note', label: 'Note' },
  { value: 'document', label: 'Document' },
  { value: 'link', label: 'Link' },
  { value: 'reference', label: 'Reference' },
  { value: 'checklist', label: 'Checklist' },
  { value: 'snippet', label: 'Snippet' },
];

export const MEMBERSHIP_STATUS_OPTIONS: readonly Readonly<{
  value: SiteMembershipStatus;
  label: string;
}>[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'withdrawn', label: 'Withdrawn' },
];
