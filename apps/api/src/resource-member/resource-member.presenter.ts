import type {
  MemberAdminNoteRecord,
  MemberRecord,
  ResourceCollectionRecord,
  ResourceRecord,
  SiteMembershipRecord,
} from '@atlas/server';

export function toCollectionData(record: Readonly<ResourceCollectionRecord>) {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    ...(record.parentId ? { parentId: record.parentId } : {}),
    name: record.name,
    ...(record.description ? { description: record.description } : {}),
    status: record.status,
    version: record.version,
    ...(record.archivedAt ? { archivedAt: record.archivedAt.toISOString() } : {}),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toResourceData(record: Readonly<ResourceRecord>) {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    ...(record.collectionId ? { collectionId: record.collectionId } : {}),
    type: record.type,
    title: record.title,
    ...(record.summary ? { summary: record.summary } : {}),
    ...(record.bodyMarkdown ? { bodyMarkdown: record.bodyMarkdown } : {}),
    ...(record.sourceUrl ? { sourceUrl: record.sourceUrl } : {}),
    visibility: record.visibility,
    sensitivity: record.sensitivity,
    ...(record.secretReference ? { secretReference: record.secretReference } : {}),
    status: record.status,
    version: record.version,
    tags: record.tags,
    projectIds: record.projectIds,
    ...(record.archivedAt ? { archivedAt: record.archivedAt.toISOString() } : {}),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toMembershipData(record: Readonly<SiteMembershipRecord>) {
  return {
    memberId: record.memberId,
    siteId: record.siteId,
    status: record.status,
    version: record.version,
    ...(record.joinedAt ? { joinedAt: record.joinedAt.toISOString() } : {}),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toMemberNoteData(record: Readonly<MemberAdminNoteRecord>) {
  return {
    id: record.id,
    body: record.body,
    createdByAdminAccountId: record.createdByAdminAccountId,
    createdAt: record.createdAt.toISOString(),
  };
}

export function toMemberData(record: Readonly<MemberRecord>) {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    ...(record.email ? { email: record.email } : {}),
    displayName: record.displayName,
    ...(record.externalProvider ? { externalProvider: record.externalProvider } : {}),
    ...(record.externalSubject ? { externalSubject: record.externalSubject } : {}),
    status: record.status,
    version: record.version,
    memberships: record.memberships.map(toMembershipData),
    notes: record.notes.map(toMemberNoteData),
    ...(record.archivedAt ? { archivedAt: record.archivedAt.toISOString() } : {}),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
