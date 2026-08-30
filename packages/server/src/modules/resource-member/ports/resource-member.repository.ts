import type {
  MemberAdminNoteRecord,
  MemberRecord,
  MemberStatus,
  ResourceCollectionRecord,
  ResourceRecord,
  ResourceSensitivity,
  ResourceStatus,
  ResourceType,
  ResourceVisibility,
  SiteMembershipRecord,
  SiteMembershipStatus,
} from '../domain/resource-member';

export interface ResourceListQuery {
  limit: number;
  collectionId?: string;
  type?: ResourceType;
  status?: ResourceStatus;
  visibility?: ResourceVisibility;
  sensitivity?: ResourceSensitivity;
  tag?: string;
  projectId?: string;
  search?: string;
}

export interface MemberListQuery {
  limit: number;
  status?: MemberStatus;
  siteId?: string;
  membershipStatus?: SiteMembershipStatus;
  search?: string;
}

export interface InsertResourceInput extends Omit<ResourceRecord, 'tags' | 'projectIds'> {
  tags: readonly string[];
  projectIds: readonly string[];
}

export interface UpdateResourceRecordInput {
  collectionId?: string;
  type: ResourceType;
  title: string;
  summary?: string;
  bodyMarkdown?: string;
  sourceUrl?: string;
  visibility: ResourceVisibility;
  sensitivity: ResourceSensitivity;
  secretReference?: string;
  tags: readonly string[];
  projectIds: readonly string[];
  expectedVersion: number;
  nextVersion: number;
  updatedAt: Date;
}

export interface InsertMemberInput extends Omit<MemberRecord, 'memberships' | 'notes'> {
  memberships: readonly SiteMembershipRecord[];
}

export interface UpdateMemberRecordInput {
  email?: string;
  normalizedEmail?: string;
  displayName: string;
  expectedVersion: number;
  nextVersion: number;
  updatedAt: Date;
}

export interface ResourceMemberRepositoryPort<TTransaction = unknown> {
  listCollections(workspaceId: string): Promise<readonly ResourceCollectionRecord[]>;
  findCollection(
    workspaceId: string,
    collectionId: string,
    transaction?: TTransaction,
  ): Promise<ResourceCollectionRecord | undefined>;
  collectionNameExists(
    workspaceId: string,
    parentId: string | undefined,
    normalizedName: string,
    excludeCollectionId?: string,
    transaction?: TTransaction,
  ): Promise<boolean>;
  insertCollection(collection: ResourceCollectionRecord, transaction: TTransaction): Promise<void>;
  updateCollection(
    workspaceId: string,
    collectionId: string,
    input: {
      name: string;
      normalizedName: string;
      description?: string;
      expectedVersion: number;
      nextVersion: number;
      updatedAt: Date;
    },
    transaction: TTransaction,
  ): Promise<boolean>;
  archiveCollection(
    workspaceId: string,
    collectionId: string,
    expectedVersion: number,
    archivedAt: Date,
    transaction: TTransaction,
  ): Promise<boolean>;

  listResources(workspaceId: string, query: ResourceListQuery): Promise<readonly ResourceRecord[]>;
  findResource(
    workspaceId: string,
    resourceId: string,
    transaction?: TTransaction,
  ): Promise<ResourceRecord | undefined>;
  insertResource(resource: InsertResourceInput, transaction: TTransaction): Promise<void>;
  updateResource(
    workspaceId: string,
    resourceId: string,
    input: UpdateResourceRecordInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  archiveResource(
    workspaceId: string,
    resourceId: string,
    expectedVersion: number,
    archivedAt: Date,
    transaction: TTransaction,
  ): Promise<boolean>;
  projectExists(
    workspaceId: string,
    projectId: string,
    transaction?: TTransaction,
  ): Promise<boolean>;

  listMembers(workspaceId: string, query: MemberListQuery): Promise<readonly MemberRecord[]>;
  findMember(
    workspaceId: string,
    memberId: string,
    transaction?: TTransaction,
  ): Promise<MemberRecord | undefined>;
  memberEmailExists(
    workspaceId: string,
    normalizedEmail: string,
    excludeMemberId?: string,
    transaction?: TTransaction,
  ): Promise<boolean>;
  memberExternalIdentityExists(
    workspaceId: string,
    provider: string,
    subject: string,
    transaction?: TTransaction,
  ): Promise<boolean>;
  siteExists(workspaceId: string, siteId: string, transaction?: TTransaction): Promise<boolean>;
  insertMember(member: InsertMemberInput, transaction: TTransaction): Promise<void>;
  updateMember(
    workspaceId: string,
    memberId: string,
    input: UpdateMemberRecordInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  archiveMember(
    workspaceId: string,
    memberId: string,
    expectedVersion: number,
    archivedAt: Date,
    transaction: TTransaction,
  ): Promise<boolean>;
  updateMembership(
    workspaceId: string,
    memberId: string,
    siteId: string,
    status: SiteMembershipStatus,
    expectedVersion: number,
    nextVersion: number,
    updatedAt: Date,
    transaction: TTransaction,
  ): Promise<boolean>;
  addMemberNote(note: MemberAdminNoteRecord, transaction: TTransaction): Promise<void>;
}
