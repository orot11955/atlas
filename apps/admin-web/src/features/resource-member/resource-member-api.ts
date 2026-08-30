import { createAdminApiClient } from '../../lib/api';
import type {
  ApiEnvelope,
  Member,
  MemberAdminNote,
  MemberStatus,
  Resource,
  ResourceCollection,
  ResourceSensitivity,
  ResourceStatus,
  ResourceType,
  ResourceVisibility,
  SiteMembership,
  SiteMembershipStatus,
} from './resource-member-types';

function client() {
  return createAdminApiClient();
}

export async function loadResourceCollections(): Promise<readonly ResourceCollection[]> {
  const response = await client().get<ApiEnvelope<readonly ResourceCollection[]>>(
    '/resource-collections',
  );
  return response.data;
}

export async function createResourceCollection(input: {
  parentId?: string;
  name: string;
  description?: string;
}): Promise<ResourceCollection> {
  const response = await client().post<ApiEnvelope<ResourceCollection>>(
    '/resource-collections',
    input,
  );
  return response.data;
}

export async function loadResources(
  input: {
    limit?: number;
    collectionId?: string;
    type?: ResourceType;
    status?: ResourceStatus;
    visibility?: ResourceVisibility;
    sensitivity?: ResourceSensitivity;
    tag?: string;
    projectId?: string;
    search?: string;
  } = {},
): Promise<readonly Resource[]> {
  const query = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  const suffix = query.toString();
  const response = await client().get<ApiEnvelope<readonly Resource[]>>(
    suffix ? `/resources?${suffix}` : '/resources',
  );
  return response.data;
}

export interface ResourceInput {
  collectionId?: string;
  type: ResourceType;
  title: string;
  summary?: string;
  bodyMarkdown?: string;
  sourceUrl?: string;
  visibility: ResourceVisibility;
  sensitivity: ResourceSensitivity;
  secretReference?: string;
  tags?: readonly string[];
  projectIds?: readonly string[];
}

export async function createResource(input: ResourceInput): Promise<Resource> {
  const response = await client().post<ApiEnvelope<Resource>>('/resources', input);
  return response.data;
}

export async function loadResource(resourceId: string): Promise<Resource> {
  const response = await client().get<ApiEnvelope<Resource>>(
    `/resources/${encodeURIComponent(resourceId)}`,
  );
  return response.data;
}

export async function updateResource(
  resourceId: string,
  input: ResourceInput & { version: number },
): Promise<Resource> {
  const response = await client().patch<ApiEnvelope<Resource>>(
    `/resources/${encodeURIComponent(resourceId)}`,
    input,
  );
  return response.data;
}

export async function archiveResource(resourceId: string, version: number): Promise<Resource> {
  const response = await client().post<ApiEnvelope<Resource>>(
    `/resources/${encodeURIComponent(resourceId)}/archive`,
    { version },
  );
  return response.data;
}

export async function loadMembers(
  input: {
    limit?: number;
    status?: MemberStatus;
    siteId?: string;
    membershipStatus?: SiteMembershipStatus;
    search?: string;
  } = {},
): Promise<readonly Member[]> {
  const query = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  const suffix = query.toString();
  const response = await client().get<ApiEnvelope<readonly Member[]>>(
    suffix ? `/members?${suffix}` : '/members',
  );
  return response.data;
}

export async function createMember(input: {
  email?: string;
  displayName: string;
  externalProvider?: string;
  externalSubject?: string;
  memberships?: readonly { siteId: string; status?: SiteMembershipStatus }[];
}): Promise<Member> {
  const response = await client().post<ApiEnvelope<Member>>('/members', input);
  return response.data;
}

export async function loadMember(memberId: string): Promise<Member> {
  const response = await client().get<ApiEnvelope<Member>>(
    `/members/${encodeURIComponent(memberId)}`,
  );
  return response.data;
}

export async function updateMember(
  memberId: string,
  input: { version: number; email?: string; displayName: string },
): Promise<Member> {
  const response = await client().patch<ApiEnvelope<Member>>(
    `/members/${encodeURIComponent(memberId)}`,
    input,
  );
  return response.data;
}

export async function archiveMember(memberId: string, version: number): Promise<Member> {
  const response = await client().post<ApiEnvelope<Member>>(
    `/members/${encodeURIComponent(memberId)}/archive`,
    { version },
  );
  return response.data;
}

export async function changeMembershipStatus(
  memberId: string,
  siteId: string,
  status: SiteMembershipStatus,
  version: number,
): Promise<SiteMembership> {
  const response = await client().post<ApiEnvelope<SiteMembership>>(
    `/members/${encodeURIComponent(memberId)}/sites/${encodeURIComponent(siteId)}/status`,
    { status, version },
  );
  return response.data;
}

export async function addMemberNote(memberId: string, body: string): Promise<MemberAdminNote> {
  const response = await client().post<ApiEnvelope<MemberAdminNote>>(
    `/members/${encodeURIComponent(memberId)}/notes`,
    { body },
  );
  return response.data;
}
