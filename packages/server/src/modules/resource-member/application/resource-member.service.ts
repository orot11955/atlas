import type { AuditService, Clock, TransactionRunner } from '../../../core';
import {
  AuditResult,
  DomainError,
  ErrorCode,
  createUuidV7,
  requestContext,
  systemClock,
} from '../../../core';
import {
  MemberStatus,
  ResourceCollectionStatus,
  ResourceSensitivity,
  ResourceStatus,
  ResourceType,
  ResourceVisibility,
  SiteMembershipStatus,
  assertNoLikelySecret,
  assertResourceContent,
  isResourceMemberUuid,
  normalizeEmail,
  normalizeExternalIdentity,
  normalizeMarkdown,
  normalizeMemberDisplayName,
  normalizeOptionalText,
  normalizeResourceCollectionName,
  normalizeResourceSourceUrl,
  normalizeResourceTags,
  normalizeResourceTitle,
  normalizeSecretReference,
  normalizeUuidList,
  type MemberAdminNoteRecord,
  type MemberRecord,
  type ResourceCollectionRecord,
  type ResourceRecord,
  type SiteMembershipRecord,
} from '../domain/resource-member';
import type {
  MemberListQuery,
  ResourceListQuery,
  ResourceMemberRepositoryPort,
} from '../ports/resource-member.repository';

export interface CreateCollectionInput {
  parentId?: string;
  name: string;
  description?: string;
}
export interface UpdateCollectionInput {
  version: number;
  name: string;
  description?: string;
}
export interface CreateResourceInput {
  collectionId?: string;
  type: ResourceType;
  title: string;
  summary?: string;
  bodyMarkdown?: string;
  sourceUrl?: string;
  visibility?: ResourceVisibility;
  sensitivity?: ResourceSensitivity;
  secretReference?: string;
  tags?: readonly string[];
  projectIds?: readonly string[];
}
export interface UpdateResourceInput extends CreateResourceInput {
  version: number;
}
export interface CreateMemberInput {
  email?: string;
  displayName: string;
  externalProvider?: string;
  externalSubject?: string;
  memberships?: readonly { siteId: string; status?: SiteMembershipStatus }[];
}
export interface UpdateMemberInput {
  version: number;
  email?: string;
  displayName: string;
}

export class ResourceMemberService<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: ResourceMemberRepositoryPort<TTransaction>,
    private readonly auditService: AuditService<TTransaction>,
    private readonly clock: Clock = systemClock,
  ) {}

  public listCollections(workspaceId: string) {
    return this.repository.listCollections(workspaceId);
  }

  public async createCollection(
    workspaceId: string,
    input: CreateCollectionInput,
  ): Promise<Readonly<ResourceCollectionRecord>> {
    const { name, normalizedName } = normalizeResourceCollectionName(input.name);
    const description = normalizeOptionalText(input.description, 500, 'description');
    const now = this.clock.now();
    const parentId = normalizeOptionalUuid(input.parentId, 'parentId');

    return this.transactionRunner.run(async (transaction) => {
      if (parentId) await this.requireActiveCollection(workspaceId, parentId, transaction);
      if (
        await this.repository.collectionNameExists(
          workspaceId,
          parentId,
          normalizedName,
          undefined,
          transaction,
        )
      ) {
        throw conflict(
          ErrorCode.RESOURCE_COLLECTION_NAME_EXISTS,
          'Collection name already exists.',
        );
      }
      const collection: ResourceCollectionRecord = {
        id: createUuidV7(now.getTime()),
        workspaceId,
        parentId,
        name,
        normalizedName,
        description,
        status: ResourceCollectionStatus.ACTIVE,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await this.repository.insertCollection(collection, transaction);
      await this.auditService.record(
        {
          action: 'resource-collection.created',
          targetType: 'resource-collection',
          targetId: collection.id,
          result: AuditResult.SUCCESS,
          metadata: { parentId: parentId ?? null, name },
        },
        transaction,
      );
      return Object.freeze(collection);
    });
  }

  public async updateCollection(
    workspaceId: string,
    collectionId: string,
    input: UpdateCollectionInput,
  ): Promise<Readonly<ResourceCollectionRecord>> {
    assertVersion(input.version);
    const { name, normalizedName } = normalizeResourceCollectionName(input.name);
    const description = normalizeOptionalText(input.description, 500, 'description');
    const now = this.clock.now();
    return this.transactionRunner.run(async (transaction) => {
      const current = await this.requireActiveCollection(workspaceId, collectionId, transaction);
      if (
        await this.repository.collectionNameExists(
          workspaceId,
          current.parentId,
          normalizedName,
          current.id,
          transaction,
        )
      ) {
        throw conflict(
          ErrorCode.RESOURCE_COLLECTION_NAME_EXISTS,
          'Collection name already exists.',
        );
      }
      const updated = await this.repository.updateCollection(
        workspaceId,
        collectionId,
        {
          name,
          normalizedName,
          description,
          expectedVersion: input.version,
          nextVersion: input.version + 1,
          updatedAt: now,
        },
        transaction,
      );
      if (!updated) throw versionConflict('Collection');
      await this.auditService.record(
        {
          action: 'resource-collection.updated',
          targetType: 'resource-collection',
          targetId: collectionId,
          result: AuditResult.SUCCESS,
          metadata: { version: input.version + 1 },
        },
        transaction,
      );
      return Object.freeze({
        ...current,
        name,
        normalizedName,
        description,
        version: input.version + 1,
        updatedAt: now,
      });
    });
  }

  public async archiveCollection(workspaceId: string, collectionId: string, version: number) {
    assertVersion(version);
    const now = this.clock.now();
    return this.transactionRunner.run(async (transaction) => {
      const current = await this.requireActiveCollection(workspaceId, collectionId, transaction);
      const updated = await this.repository.archiveCollection(
        workspaceId,
        collectionId,
        version,
        now,
        transaction,
      );
      if (!updated) throw versionConflict('Collection');
      await this.auditService.record(
        {
          action: 'resource-collection.archived',
          targetType: 'resource-collection',
          targetId: collectionId,
          result: AuditResult.SUCCESS,
          metadata: { version: version + 1 },
        },
        transaction,
      );
      return Object.freeze({
        ...current,
        status: ResourceCollectionStatus.ARCHIVED,
        version: version + 1,
        archivedAt: now,
        updatedAt: now,
      });
    });
  }

  public listResources(workspaceId: string, query: Partial<ResourceListQuery> = {}) {
    return this.repository.listResources(workspaceId, {
      limit: normalizeLimit(query.limit),
      collectionId: query.collectionId,
      type: query.type,
      status: query.status,
      visibility: query.visibility,
      sensitivity: query.sensitivity,
      tag: query.tag?.trim().toLocaleLowerCase('en-US') || undefined,
      projectId: query.projectId,
      search: normalizeSearch(query.search),
    });
  }

  public async getResource(workspaceId: string, resourceId: string) {
    const resource = await this.repository.findResource(workspaceId, resourceId);
    if (!resource) throw notFound(ErrorCode.RESOURCE_NOT_FOUND, 'Resource was not found.');
    return Object.freeze(resource);
  }

  public async createResource(workspaceId: string, input: CreateResourceInput) {
    const normalized = normalizeResourceInput(input);
    const now = this.clock.now();
    return this.transactionRunner.run(async (transaction) => {
      await this.validateResourceReferences(workspaceId, normalized, transaction);
      const resource: ResourceRecord = {
        id: createUuidV7(now.getTime()),
        workspaceId,
        ...normalized,
        status: ResourceStatus.ACTIVE,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await this.repository.insertResource(resource, transaction);
      await this.auditService.record(
        {
          action: 'resource.created',
          targetType: 'resource',
          targetId: resource.id,
          result: AuditResult.SUCCESS,
          metadata: {
            type: resource.type,
            visibility: resource.visibility,
            sensitivity: resource.sensitivity,
            tagCount: resource.tags.length,
            projectCount: resource.projectIds.length,
          },
        },
        transaction,
      );
      return Object.freeze(resource);
    });
  }

  public async updateResource(workspaceId: string, resourceId: string, input: UpdateResourceInput) {
    assertVersion(input.version);
    const normalized = normalizeResourceInput(input);
    const now = this.clock.now();
    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findResource(workspaceId, resourceId, transaction);
      if (!current) throw notFound(ErrorCode.RESOURCE_NOT_FOUND, 'Resource was not found.');
      if (current.status === ResourceStatus.ARCHIVED) {
        throw new DomainError({
          code: ErrorCode.ACTION_NOT_ALLOWED,
          message: 'Archived Resources cannot be modified.',
        });
      }
      await this.validateResourceReferences(workspaceId, normalized, transaction);
      const updated = await this.repository.updateResource(
        workspaceId,
        resourceId,
        {
          ...normalized,
          expectedVersion: input.version,
          nextVersion: input.version + 1,
          updatedAt: now,
        },
        transaction,
      );
      if (!updated) throw versionConflict('Resource');
      await this.auditService.record(
        {
          action: 'resource.updated',
          targetType: 'resource',
          targetId: resourceId,
          result: AuditResult.SUCCESS,
          metadata: { version: input.version + 1 },
        },
        transaction,
      );
      return Object.freeze({
        ...current,
        ...normalized,
        version: input.version + 1,
        updatedAt: now,
      });
    });
  }

  public async archiveResource(workspaceId: string, resourceId: string, version: number) {
    assertVersion(version);
    const now = this.clock.now();
    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findResource(workspaceId, resourceId, transaction);
      if (!current) throw notFound(ErrorCode.RESOURCE_NOT_FOUND, 'Resource was not found.');
      const updated = await this.repository.archiveResource(
        workspaceId,
        resourceId,
        version,
        now,
        transaction,
      );
      if (!updated) throw versionConflict('Resource');
      await this.auditService.record(
        {
          action: 'resource.archived',
          targetType: 'resource',
          targetId: resourceId,
          result: AuditResult.SUCCESS,
          metadata: { version: version + 1 },
        },
        transaction,
      );
      return Object.freeze({
        ...current,
        status: ResourceStatus.ARCHIVED,
        version: version + 1,
        archivedAt: now,
        updatedAt: now,
      });
    });
  }

  public listMembers(workspaceId: string, query: Partial<MemberListQuery> = {}) {
    return this.repository.listMembers(workspaceId, {
      limit: normalizeLimit(query.limit),
      status: query.status,
      siteId: query.siteId,
      membershipStatus: query.membershipStatus,
      search: normalizeSearch(query.search),
    });
  }

  public async getMember(workspaceId: string, memberId: string) {
    const member = await this.repository.findMember(workspaceId, memberId);
    if (!member) throw notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member was not found.');
    return Object.freeze(member);
  }

  public async createMember(workspaceId: string, input: CreateMemberInput) {
    const { email, normalizedEmail } = normalizeEmail(input.email);
    const displayName = normalizeMemberDisplayName(input.displayName);
    const external = normalizeExternalIdentity(input.externalProvider, input.externalSubject);
    assertNoLikelySecret([displayName, email, external.provider, external.subject]);
    if (!email && !external.provider) {
      throw new DomainError({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Member requires an email or external identity.',
      });
    }
    const memberships = normalizeMembershipInput(input.memberships);
    const now = this.clock.now();
    const memberId = createUuidV7(now.getTime());
    return this.transactionRunner.run(async (transaction) => {
      if (
        normalizedEmail &&
        (await this.repository.memberEmailExists(
          workspaceId,
          normalizedEmail,
          undefined,
          transaction,
        ))
      ) {
        throw conflict(ErrorCode.MEMBER_EMAIL_ALREADY_EXISTS, 'Member email already exists.');
      }
      if (
        external.provider &&
        external.subject &&
        (await this.repository.memberExternalIdentityExists(
          workspaceId,
          external.provider,
          external.subject,
          transaction,
        ))
      ) {
        throw conflict(
          ErrorCode.MEMBER_EXTERNAL_IDENTITY_EXISTS,
          'External member identity already exists.',
        );
      }
      const membershipRecords: SiteMembershipRecord[] = [];
      for (const membership of memberships) {
        if (!(await this.repository.siteExists(workspaceId, membership.siteId, transaction))) {
          throw notFound(ErrorCode.SITE_NOT_FOUND, 'Membership Site was not found.');
        }
        membershipRecords.push({
          memberId,
          siteId: membership.siteId,
          workspaceId,
          status: membership.status,
          version: 1,
          joinedAt: membership.status === SiteMembershipStatus.ACTIVE ? now : undefined,
          updatedAt: now,
        });
      }
      const member: MemberRecord = {
        id: memberId,
        workspaceId,
        email,
        normalizedEmail,
        displayName,
        externalProvider: external.provider,
        externalSubject: external.subject,
        status: MemberStatus.ACTIVE,
        version: 1,
        memberships: membershipRecords,
        notes: [],
        createdAt: now,
        updatedAt: now,
      };
      await this.repository.insertMember(member, transaction);
      await this.auditService.record(
        {
          action: 'member.created',
          targetType: 'member',
          targetId: memberId,
          result: AuditResult.SUCCESS,
          metadata: {
            hasEmail: Boolean(email),
            externalProvider: external.provider ?? null,
            membershipCount: membershipRecords.length,
          },
        },
        transaction,
      );
      return Object.freeze(member);
    });
  }

  public async updateMember(workspaceId: string, memberId: string, input: UpdateMemberInput) {
    assertVersion(input.version);
    const { email, normalizedEmail } = normalizeEmail(input.email);
    const displayName = normalizeMemberDisplayName(input.displayName);
    assertNoLikelySecret([displayName, email]);
    const now = this.clock.now();
    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findMember(workspaceId, memberId, transaction);
      if (!current) throw notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member was not found.');
      if (current.status === MemberStatus.ARCHIVED) {
        throw new DomainError({
          code: ErrorCode.ACTION_NOT_ALLOWED,
          message: 'Archived Members cannot be modified.',
        });
      }
      if (
        normalizedEmail &&
        (await this.repository.memberEmailExists(
          workspaceId,
          normalizedEmail,
          memberId,
          transaction,
        ))
      ) {
        throw conflict(ErrorCode.MEMBER_EMAIL_ALREADY_EXISTS, 'Member email already exists.');
      }
      const updated = await this.repository.updateMember(
        workspaceId,
        memberId,
        {
          email,
          normalizedEmail,
          displayName,
          expectedVersion: input.version,
          nextVersion: input.version + 1,
          updatedAt: now,
        },
        transaction,
      );
      if (!updated) throw versionConflict('Member');
      await this.auditService.record(
        {
          action: 'member.updated',
          targetType: 'member',
          targetId: memberId,
          result: AuditResult.SUCCESS,
          metadata: { version: input.version + 1 },
        },
        transaction,
      );
      return Object.freeze({
        ...current,
        email,
        normalizedEmail,
        displayName,
        version: input.version + 1,
        updatedAt: now,
      });
    });
  }

  public async changeMembershipStatus(
    workspaceId: string,
    memberId: string,
    siteId: string,
    status: SiteMembershipStatus,
    version: number,
  ) {
    assertVersion(version);
    const now = this.clock.now();
    return this.transactionRunner.run(async (transaction) => {
      const member = await this.repository.findMember(workspaceId, memberId, transaction);
      if (!member) throw notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member was not found.');
      const current = member.memberships.find((membership) => membership.siteId === siteId);
      if (!current) {
        throw notFound(ErrorCode.SITE_MEMBERSHIP_NOT_FOUND, 'Site Membership was not found.');
      }
      const updated = await this.repository.updateMembership(
        workspaceId,
        memberId,
        siteId,
        status,
        version,
        version + 1,
        now,
        transaction,
      );
      if (!updated) throw versionConflict('Site Membership');
      await this.auditService.record(
        {
          action: 'member.membership-status-changed',
          targetType: 'member',
          targetId: memberId,
          result: AuditResult.SUCCESS,
          metadata: { siteId, previousStatus: current.status, status, version: version + 1 },
        },
        transaction,
      );
      return Object.freeze({
        ...current,
        status,
        version: version + 1,
        joinedAt: current.joinedAt ?? (status === SiteMembershipStatus.ACTIVE ? now : undefined),
        updatedAt: now,
      });
    });
  }

  public async addMemberNote(workspaceId: string, memberId: string, bodyValue: string) {
    const body = normalizeOptionalText(bodyValue, 2_000, 'body');
    if (!body)
      throw new DomainError({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Note body is required.',
      });
    assertNoLikelySecret([body]);
    const actorId = requestContext.require().actorId;
    if (!actorId)
      throw new DomainError({
        code: ErrorCode.AUTH_REQUIRED,
        message: 'Administrator actor is required.',
      });
    const now = this.clock.now();
    return this.transactionRunner.run(async (transaction) => {
      if (!(await this.repository.findMember(workspaceId, memberId, transaction))) {
        throw notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member was not found.');
      }
      const note: MemberAdminNoteRecord = {
        id: createUuidV7(now.getTime()),
        workspaceId,
        memberId,
        body,
        createdByAdminAccountId: actorId,
        createdAt: now,
      };
      await this.repository.addMemberNote(note, transaction);
      await this.auditService.record(
        {
          action: 'member.note-created',
          targetType: 'member',
          targetId: memberId,
          result: AuditResult.SUCCESS,
          metadata: { noteId: note.id },
        },
        transaction,
      );
      return Object.freeze(note);
    });
  }

  public async archiveMember(workspaceId: string, memberId: string, version: number) {
    assertVersion(version);
    const now = this.clock.now();
    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findMember(workspaceId, memberId, transaction);
      if (!current) throw notFound(ErrorCode.MEMBER_NOT_FOUND, 'Member was not found.');
      const updated = await this.repository.archiveMember(
        workspaceId,
        memberId,
        version,
        now,
        transaction,
      );
      if (!updated) throw versionConflict('Member');
      await this.auditService.record(
        {
          action: 'member.archived',
          targetType: 'member',
          targetId: memberId,
          result: AuditResult.SUCCESS,
          metadata: { version: version + 1 },
        },
        transaction,
      );
      return Object.freeze({
        ...current,
        status: MemberStatus.ARCHIVED,
        version: version + 1,
        archivedAt: now,
        updatedAt: now,
      });
    });
  }

  private async requireActiveCollection(
    workspaceId: string,
    collectionId: string,
    transaction: TTransaction,
  ) {
    const collection = await this.repository.findCollection(workspaceId, collectionId, transaction);
    if (!collection) {
      throw notFound(ErrorCode.RESOURCE_COLLECTION_NOT_FOUND, 'Resource Collection was not found.');
    }
    if (collection.status === ResourceCollectionStatus.ARCHIVED) {
      throw new DomainError({
        code: ErrorCode.ACTION_NOT_ALLOWED,
        message: 'Archived Collections cannot be modified.',
      });
    }
    return collection;
  }

  private async validateResourceReferences(
    workspaceId: string,
    input: ReturnType<typeof normalizeResourceInput>,
    transaction: TTransaction,
  ) {
    if (input.collectionId) {
      await this.requireActiveCollection(workspaceId, input.collectionId, transaction);
    }
    for (const projectId of input.projectIds) {
      if (!(await this.repository.projectExists(workspaceId, projectId, transaction))) {
        throw notFound(ErrorCode.PROJECT_NOT_FOUND, 'Related Project was not found.');
      }
    }
  }
}

function normalizeResourceInput(input: CreateResourceInput) {
  const collectionId = normalizeOptionalUuid(input.collectionId, 'collectionId');
  const type = input.type;
  const title = normalizeResourceTitle(input.title);
  const summary = normalizeOptionalText(input.summary, 1_000, 'summary');
  const bodyMarkdown = normalizeMarkdown(input.bodyMarkdown);
  const sourceUrl = normalizeResourceSourceUrl(input.sourceUrl);
  const visibility = input.visibility ?? ResourceVisibility.PRIVATE;
  const sensitivity = input.sensitivity ?? ResourceSensitivity.NORMAL;
  const secretReference = normalizeSecretReference(input.secretReference);
  const tags = normalizeResourceTags(input.tags);
  const projectIds = normalizeUuidList(input.projectIds, 'projectIds');
  assertResourceContent(type, bodyMarkdown, sourceUrl);
  assertNoLikelySecret([title, summary, bodyMarkdown, sourceUrl]);
  return {
    collectionId,
    type,
    title,
    summary,
    bodyMarkdown,
    sourceUrl,
    visibility,
    sensitivity,
    secretReference,
    tags,
    projectIds,
  };
}

function normalizeMembershipInput(
  values: CreateMemberInput['memberships'],
): readonly { siteId: string; status: SiteMembershipStatus }[] {
  const seen = new Set<string>();
  const normalized = (values ?? []).map((membership) => {
    if (!isResourceMemberUuid(membership.siteId) || seen.has(membership.siteId)) {
      throw new DomainError({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Membership Site IDs must be unique UUID values.',
      });
    }
    seen.add(membership.siteId);
    return {
      siteId: membership.siteId,
      status: membership.status ?? SiteMembershipStatus.PENDING,
    };
  });
  if (normalized.length > 100) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Member has too many Site Memberships.',
    });
  }
  return Object.freeze(normalized);
}

function normalizeOptionalUuid(value: string | undefined, field: string) {
  if (!value) return undefined;
  if (!isResourceMemberUuid(value)) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: `${field} must be a UUID.`,
      details: { field },
    });
  }
  return value;
}

function normalizeLimit(value: number | undefined) {
  if (value === undefined) return 100;
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Limit must be between 1 and 200.',
    });
  }
  return value;
}

function normalizeSearch(value: string | undefined) {
  const normalized = value?.trim().replace(/\s+/gu, ' ');
  if (!normalized) return undefined;
  if (normalized.length > 120) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Search query is too long.',
    });
  }
  return normalized;
}

function assertVersion(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainError({ code: ErrorCode.VALIDATION_FAILED, message: 'Version is invalid.' });
  }
}

function conflict(code: string, message: string) {
  return new DomainError({ code, message });
}
function notFound(code: string, message: string) {
  return new DomainError({ code, message });
}
function versionConflict(target: string) {
  return new DomainError({
    code: ErrorCode.VERSION_CONFLICT,
    message: `${target} was changed by another request.`,
  });
}
