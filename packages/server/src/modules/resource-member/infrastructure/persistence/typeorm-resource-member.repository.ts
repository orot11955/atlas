import { In, type DataSource, type EntityManager, type Repository } from 'typeorm';

import { createUuidV7 } from '../../../../core';
import { ProjectEntity } from '../../../project-deployment/infrastructure/persistence/project-deployment.entities';
import { SiteEntity } from '../../../site/infrastructure/persistence/site.entity';
import {
  MemberStatus,
  ResourceCollectionStatus,
  ResourceRelationTargetType,
  ResourceRelationType,
  ResourceStatus,
  SiteMembershipStatus,
  type MemberAdminNoteRecord,
  type MemberRecord,
  type ResourceCollectionRecord,
  type ResourceRecord,
  type SiteMembershipRecord,
} from '../../domain/resource-member';
import type {
  InsertMemberInput,
  InsertResourceInput,
  MemberListQuery,
  ResourceListQuery,
  ResourceMemberRepositoryPort,
  UpdateMemberRecordInput,
  UpdateResourceRecordInput,
} from '../../ports/resource-member.repository';
import {
  MemberAdminNoteEntity,
  MemberEntity,
  ResourceCollectionEntity,
  ResourceEntity,
  ResourceRelationEntity,
  ResourceTagAssignmentEntity,
  ResourceTagEntity,
  SiteMembershipEntity,
} from './resource-member.entities';

export class TypeOrmResourceMemberRepository implements ResourceMemberRepositoryPort<EntityManager> {
  public constructor(private readonly dataSource: DataSource) {}

  public async listCollections(workspaceId: string): Promise<readonly ResourceCollectionRecord[]> {
    const entities = await this.dataSource.getRepository(ResourceCollectionEntity).find({
      where: { workspaceId },
      order: { status: 'ASC', name: 'ASC' },
    });
    return entities.map(toCollection);
  }

  public async findCollection(
    workspaceId: string,
    collectionId: string,
    transaction?: EntityManager,
  ): Promise<ResourceCollectionRecord | undefined> {
    const entity = await this.repository(ResourceCollectionEntity, transaction).findOne({
      where: { id: collectionId, workspaceId },
    });
    return entity ? toCollection(entity) : undefined;
  }

  public async collectionNameExists(
    workspaceId: string,
    parentId: string | undefined,
    normalizedName: string,
    excludeCollectionId?: string,
    transaction?: EntityManager,
  ): Promise<boolean> {
    const builder = this.repository(ResourceCollectionEntity, transaction)
      .createQueryBuilder('collection')
      .where('collection.workspace_id = :workspaceId', { workspaceId })
      .andWhere('collection.normalized_name = :normalizedName', { normalizedName })
      .andWhere('collection.status = :status', {
        status: ResourceCollectionStatus.ACTIVE,
      });
    if (parentId) {
      builder.andWhere('collection.parent_id = :parentId', { parentId });
    } else {
      builder.andWhere('collection.parent_id IS NULL');
    }
    if (excludeCollectionId) {
      builder.andWhere('collection.id <> :excludeCollectionId', {
        excludeCollectionId,
      });
    }
    return (await builder.getCount()) > 0;
  }

  public async insertCollection(
    collection: ResourceCollectionRecord,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(ResourceCollectionEntity).insert({
      id: collection.id,
      workspaceId: collection.workspaceId,
      parentId: collection.parentId ?? null,
      name: collection.name,
      normalizedName: collection.normalizedName,
      description: collection.description ?? null,
      status: collection.status,
      version: collection.version,
      archivedAt: collection.archivedAt ?? null,
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
    });
  }

  public async updateCollection(
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
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(ResourceCollectionEntity).update(
      {
        id: collectionId,
        workspaceId,
        version: input.expectedVersion,
        status: ResourceCollectionStatus.ACTIVE,
      },
      {
        name: input.name,
        normalizedName: input.normalizedName,
        description: input.description ?? null,
        version: input.nextVersion,
        updatedAt: input.updatedAt,
      },
    );
    return (result.affected ?? 0) === 1;
  }

  public async archiveCollection(
    workspaceId: string,
    collectionId: string,
    expectedVersion: number,
    archivedAt: Date,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(ResourceCollectionEntity).update(
      {
        id: collectionId,
        workspaceId,
        version: expectedVersion,
        status: ResourceCollectionStatus.ACTIVE,
      },
      {
        status: ResourceCollectionStatus.ARCHIVED,
        version: expectedVersion + 1,
        archivedAt,
        updatedAt: archivedAt,
      },
    );
    return (result.affected ?? 0) === 1;
  }

  public async listResources(
    workspaceId: string,
    query: ResourceListQuery,
  ): Promise<readonly ResourceRecord[]> {
    const builder = this.dataSource
      .getRepository(ResourceEntity)
      .createQueryBuilder('resource')
      .where('resource.workspace_id = :workspaceId', { workspaceId });

    if (query.collectionId) {
      builder.andWhere('resource.collection_id = :collectionId', {
        collectionId: query.collectionId,
      });
    }
    if (query.type) builder.andWhere('resource.type = :type', { type: query.type });
    if (query.status) {
      builder.andWhere('resource.status = :status', { status: query.status });
    }
    if (query.visibility) {
      builder.andWhere('resource.visibility = :visibility', {
        visibility: query.visibility,
      });
    }
    if (query.sensitivity) {
      builder.andWhere('resource.sensitivity = :sensitivity', {
        sensitivity: query.sensitivity,
      });
    }
    if (query.search) {
      builder.andWhere(
        '(resource.title ILIKE :search OR resource.summary ILIKE :search OR resource.body_markdown ILIKE :search)',
        { search: `%${escapeLike(query.search)}%` },
      );
    }
    if (query.tag) {
      builder.andWhere(
        `EXISTS (
          SELECT 1
          FROM resource_tag_assignments assignment
          INNER JOIN resource_tags tag ON tag.id = assignment.tag_id
          WHERE assignment.resource_id = resource.id
            AND assignment.workspace_id = :workspaceId
            AND tag.normalized_name = :tag
        )`,
        { tag: query.tag },
      );
    }
    if (query.projectId) {
      builder.andWhere(
        `EXISTS (
          SELECT 1 FROM resource_relations relation
          WHERE relation.resource_id = resource.id
            AND relation.workspace_id = :workspaceId
            AND relation.target_type = 'project'
            AND relation.target_id = :projectId
        )`,
        { projectId: query.projectId },
      );
    }

    const entities = await builder
      .orderBy('resource.updated_at', 'DESC')
      .addOrderBy('resource.id', 'DESC')
      .take(query.limit)
      .getMany();
    return this.hydrateResources(entities, this.dataSource.manager);
  }

  public async findResource(
    workspaceId: string,
    resourceId: string,
    transaction?: EntityManager,
  ): Promise<ResourceRecord | undefined> {
    const manager = transaction ?? this.dataSource.manager;
    const entity = await manager.getRepository(ResourceEntity).findOne({
      where: { id: resourceId, workspaceId },
    });
    if (!entity) return undefined;
    const [record] = await this.hydrateResources([entity], manager);
    return record;
  }

  public async insertResource(
    resource: InsertResourceInput,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(ResourceEntity).insert({
      id: resource.id,
      workspaceId: resource.workspaceId,
      collectionId: resource.collectionId ?? null,
      type: resource.type,
      title: resource.title,
      summary: resource.summary ?? null,
      bodyMarkdown: resource.bodyMarkdown ?? null,
      sourceUrl: resource.sourceUrl ?? null,
      visibility: resource.visibility,
      sensitivity: resource.sensitivity,
      secretReference: resource.secretReference ?? null,
      status: resource.status,
      version: resource.version,
      archivedAt: resource.archivedAt ?? null,
      createdAt: resource.createdAt,
      updatedAt: resource.updatedAt,
    });
    await this.replaceResourceTags(
      resource.workspaceId,
      resource.id,
      resource.tags,
      resource.createdAt,
      transaction,
    );
    await this.replaceProjectRelations(
      resource.workspaceId,
      resource.id,
      resource.projectIds,
      resource.createdAt,
      transaction,
    );
  }

  public async updateResource(
    workspaceId: string,
    resourceId: string,
    input: UpdateResourceRecordInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(ResourceEntity).update(
      {
        id: resourceId,
        workspaceId,
        version: input.expectedVersion,
        status: ResourceStatus.ACTIVE,
      },
      {
        collectionId: input.collectionId ?? null,
        type: input.type,
        title: input.title,
        summary: input.summary ?? null,
        bodyMarkdown: input.bodyMarkdown ?? null,
        sourceUrl: input.sourceUrl ?? null,
        visibility: input.visibility,
        sensitivity: input.sensitivity,
        secretReference: input.secretReference ?? null,
        version: input.nextVersion,
        updatedAt: input.updatedAt,
      },
    );
    if ((result.affected ?? 0) !== 1) return false;
    await this.replaceResourceTags(
      workspaceId,
      resourceId,
      input.tags,
      input.updatedAt,
      transaction,
    );
    await this.replaceProjectRelations(
      workspaceId,
      resourceId,
      input.projectIds,
      input.updatedAt,
      transaction,
    );
    return true;
  }

  public async archiveResource(
    workspaceId: string,
    resourceId: string,
    expectedVersion: number,
    archivedAt: Date,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(ResourceEntity).update(
      {
        id: resourceId,
        workspaceId,
        version: expectedVersion,
        status: ResourceStatus.ACTIVE,
      },
      {
        status: ResourceStatus.ARCHIVED,
        version: expectedVersion + 1,
        archivedAt,
        updatedAt: archivedAt,
      },
    );
    return (result.affected ?? 0) === 1;
  }

  public async projectExists(
    workspaceId: string,
    projectId: string,
    transaction?: EntityManager,
  ): Promise<boolean> {
    return (
      (await this.repository(ProjectEntity, transaction).count({
        where: { id: projectId, workspaceId },
      })) > 0
    );
  }

  public async listMembers(
    workspaceId: string,
    query: MemberListQuery,
  ): Promise<readonly MemberRecord[]> {
    const builder = this.dataSource
      .getRepository(MemberEntity)
      .createQueryBuilder('member')
      .where('member.workspace_id = :workspaceId', { workspaceId });
    if (query.status) builder.andWhere('member.status = :status', { status: query.status });
    if (query.search) {
      builder.andWhere(
        '(member.display_name ILIKE :search OR member.email ILIKE :search OR member.external_subject ILIKE :search)',
        { search: `%${escapeLike(query.search)}%` },
      );
    }
    if (query.siteId) {
      builder.andWhere(
        `EXISTS (
          SELECT 1 FROM site_memberships membership
          WHERE membership.member_id = member.id
            AND membership.workspace_id = :workspaceId
            AND membership.site_id = :siteId
            ${query.membershipStatus ? 'AND membership.status = :membershipStatus' : ''}
        )`,
        {
          siteId: query.siteId,
          ...(query.membershipStatus ? { membershipStatus: query.membershipStatus } : {}),
        },
      );
    }
    const entities = await builder
      .orderBy('member.created_at', 'DESC')
      .addOrderBy('member.id', 'DESC')
      .take(query.limit)
      .getMany();
    return this.hydrateMembers(entities, this.dataSource.manager);
  }

  public async findMember(
    workspaceId: string,
    memberId: string,
    transaction?: EntityManager,
  ): Promise<MemberRecord | undefined> {
    const manager = transaction ?? this.dataSource.manager;
    const entity = await manager.getRepository(MemberEntity).findOne({
      where: { id: memberId, workspaceId },
    });
    if (!entity) return undefined;
    const [record] = await this.hydrateMembers([entity], manager);
    return record;
  }

  public async memberEmailExists(
    workspaceId: string,
    normalizedEmail: string,
    excludeMemberId?: string,
    transaction?: EntityManager,
  ): Promise<boolean> {
    const builder = this.repository(MemberEntity, transaction)
      .createQueryBuilder('member')
      .where('member.workspace_id = :workspaceId', { workspaceId })
      .andWhere('member.normalized_email = :normalizedEmail', { normalizedEmail });
    if (excludeMemberId) {
      builder.andWhere('member.id <> :excludeMemberId', { excludeMemberId });
    }
    return (await builder.getCount()) > 0;
  }

  public async memberExternalIdentityExists(
    workspaceId: string,
    provider: string,
    subject: string,
    transaction?: EntityManager,
  ): Promise<boolean> {
    return (
      (await this.repository(MemberEntity, transaction).count({
        where: {
          workspaceId,
          externalProvider: provider,
          externalSubject: subject,
        },
      })) > 0
    );
  }

  public async siteExists(
    workspaceId: string,
    siteId: string,
    transaction?: EntityManager,
  ): Promise<boolean> {
    return (
      (await this.repository(SiteEntity, transaction).count({
        where: { id: siteId, workspaceId },
      })) > 0
    );
  }

  public async insertMember(member: InsertMemberInput, transaction: EntityManager): Promise<void> {
    await transaction.getRepository(MemberEntity).insert({
      id: member.id,
      workspaceId: member.workspaceId,
      email: member.email ?? null,
      normalizedEmail: member.normalizedEmail ?? null,
      displayName: member.displayName,
      externalProvider: member.externalProvider ?? null,
      externalSubject: member.externalSubject ?? null,
      status: member.status,
      version: member.version,
      archivedAt: member.archivedAt ?? null,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
    });
    if (member.memberships.length > 0) {
      await transaction.getRepository(SiteMembershipEntity).insert(
        member.memberships.map((membership) => ({
          memberId: membership.memberId,
          siteId: membership.siteId,
          workspaceId: membership.workspaceId,
          status: membership.status,
          version: membership.version,
          joinedAt: membership.joinedAt ?? null,
          updatedAt: membership.updatedAt,
        })),
      );
    }
  }

  public async updateMember(
    workspaceId: string,
    memberId: string,
    input: UpdateMemberRecordInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(MemberEntity).update(
      {
        id: memberId,
        workspaceId,
        version: input.expectedVersion,
        status: MemberStatus.ACTIVE,
      },
      {
        email: input.email ?? null,
        normalizedEmail: input.normalizedEmail ?? null,
        displayName: input.displayName,
        version: input.nextVersion,
        updatedAt: input.updatedAt,
      },
    );
    return (result.affected ?? 0) === 1;
  }

  public async archiveMember(
    workspaceId: string,
    memberId: string,
    expectedVersion: number,
    archivedAt: Date,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(MemberEntity).update(
      {
        id: memberId,
        workspaceId,
        version: expectedVersion,
        status: MemberStatus.ACTIVE,
      },
      {
        status: MemberStatus.ARCHIVED,
        version: expectedVersion + 1,
        archivedAt,
        updatedAt: archivedAt,
      },
    );
    return (result.affected ?? 0) === 1;
  }

  public async updateMembership(
    workspaceId: string,
    memberId: string,
    siteId: string,
    status: SiteMembershipStatus,
    expectedVersion: number,
    nextVersion: number,
    updatedAt: Date,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(SiteMembershipEntity).update(
      { memberId, siteId, workspaceId, version: expectedVersion },
      {
        status,
        version: nextVersion,
        joinedAt:
          status === SiteMembershipStatus.ACTIVE
            ? () => 'COALESCE(joined_at, CURRENT_TIMESTAMP)'
            : undefined,
        updatedAt,
      },
    );
    return (result.affected ?? 0) === 1;
  }

  public async addMemberNote(
    note: MemberAdminNoteRecord,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(MemberAdminNoteEntity).insert(note);
  }

  private repository<TEntity extends object>(
    entity: { new (): TEntity },
    transaction?: EntityManager,
  ): Repository<TEntity> {
    return (transaction ?? this.dataSource.manager).getRepository(entity);
  }

  private async hydrateResources(
    entities: readonly ResourceEntity[],
    manager: EntityManager,
  ): Promise<ResourceRecord[]> {
    if (entities.length === 0) return [];
    const ids = entities.map((entity) => entity.id);
    const assignments = await manager.getRepository(ResourceTagAssignmentEntity).find({
      where: { resourceId: In(ids) },
    });
    const tagIds = [...new Set(assignments.map((assignment) => assignment.tagId))];
    const tags = tagIds.length
      ? await manager.getRepository(ResourceTagEntity).find({ where: { id: In(tagIds) } })
      : [];
    const tagNameById = new Map(tags.map((tag) => [tag.id, tag.normalizedName]));
    const tagsByResource = new Map<string, string[]>();
    for (const assignment of assignments) {
      const name = tagNameById.get(assignment.tagId);
      if (name) {
        const values = tagsByResource.get(assignment.resourceId) ?? [];
        values.push(name);
        tagsByResource.set(assignment.resourceId, values);
      }
    }
    const relations = await manager.getRepository(ResourceRelationEntity).find({
      where: {
        resourceId: In(ids),
        targetType: ResourceRelationTargetType.PROJECT,
        relationType: ResourceRelationType.RELATED_TO,
      },
    });
    const projectsByResource = new Map<string, string[]>();
    for (const relation of relations) {
      const values = projectsByResource.get(relation.resourceId) ?? [];
      values.push(relation.targetId);
      projectsByResource.set(relation.resourceId, values);
    }
    return entities.map((entity) => ({
      id: entity.id,
      workspaceId: entity.workspaceId,
      collectionId: entity.collectionId ?? undefined,
      type: entity.type,
      title: entity.title,
      summary: entity.summary ?? undefined,
      bodyMarkdown: entity.bodyMarkdown ?? undefined,
      sourceUrl: entity.sourceUrl ?? undefined,
      visibility: entity.visibility,
      sensitivity: entity.sensitivity,
      secretReference: entity.secretReference ?? undefined,
      status: entity.status,
      version: entity.version,
      tags: Object.freeze((tagsByResource.get(entity.id) ?? []).sort()),
      projectIds: Object.freeze((projectsByResource.get(entity.id) ?? []).sort()),
      archivedAt: entity.archivedAt ? new Date(entity.archivedAt) : undefined,
      createdAt: new Date(entity.createdAt),
      updatedAt: new Date(entity.updatedAt),
    }));
  }

  private async replaceResourceTags(
    workspaceId: string,
    resourceId: string,
    tags: readonly string[],
    now: Date,
    transaction: EntityManager,
  ) {
    await transaction.getRepository(ResourceTagAssignmentEntity).delete({ resourceId });
    for (const name of tags) {
      await transaction
        .getRepository(ResourceTagEntity)
        .createQueryBuilder()
        .insert()
        .values({
          id: createUuidV7(now.getTime()),
          workspaceId,
          name,
          normalizedName: name,
          createdAt: now,
        })
        .orIgnore()
        .execute();
      const tag = await transaction.getRepository(ResourceTagEntity).findOneOrFail({
        where: { workspaceId, normalizedName: name },
      });
      await transaction.getRepository(ResourceTagAssignmentEntity).insert({
        resourceId,
        tagId: tag.id,
        workspaceId,
        createdAt: now,
      });
    }
  }

  private async replaceProjectRelations(
    workspaceId: string,
    resourceId: string,
    projectIds: readonly string[],
    now: Date,
    transaction: EntityManager,
  ) {
    await transaction.getRepository(ResourceRelationEntity).delete({
      resourceId,
      targetType: ResourceRelationTargetType.PROJECT,
      relationType: ResourceRelationType.RELATED_TO,
    });
    if (projectIds.length > 0) {
      await transaction.getRepository(ResourceRelationEntity).insert(
        projectIds.map((projectId) => ({
          id: createUuidV7(now.getTime()),
          workspaceId,
          resourceId,
          targetType: ResourceRelationTargetType.PROJECT,
          targetId: projectId,
          relationType: ResourceRelationType.RELATED_TO,
          createdAt: now,
        })),
      );
    }
  }

  private async hydrateMembers(
    entities: readonly MemberEntity[],
    manager: EntityManager,
  ): Promise<MemberRecord[]> {
    if (entities.length === 0) return [];
    const ids = entities.map((entity) => entity.id);
    const memberships = await manager.getRepository(SiteMembershipEntity).find({
      where: { memberId: In(ids) },
      order: { updatedAt: 'DESC' },
    });
    const notes = await manager.getRepository(MemberAdminNoteEntity).find({
      where: { memberId: In(ids) },
      order: { createdAt: 'DESC' },
      take: Math.min(ids.length * 100, 5_000),
    });
    const membershipsByMember = new Map<string, SiteMembershipRecord[]>();
    for (const membership of memberships) {
      const values = membershipsByMember.get(membership.memberId) ?? [];
      values.push({
        memberId: membership.memberId,
        siteId: membership.siteId,
        workspaceId: membership.workspaceId,
        status: membership.status,
        version: membership.version,
        joinedAt: membership.joinedAt ? new Date(membership.joinedAt) : undefined,
        updatedAt: new Date(membership.updatedAt),
      });
      membershipsByMember.set(membership.memberId, values);
    }
    const notesByMember = new Map<string, MemberAdminNoteRecord[]>();
    for (const note of notes) {
      const values = notesByMember.get(note.memberId) ?? [];
      values.push({
        id: note.id,
        workspaceId: note.workspaceId,
        memberId: note.memberId,
        body: note.body,
        createdByAdminAccountId: note.createdByAdminAccountId,
        createdAt: new Date(note.createdAt),
      });
      notesByMember.set(note.memberId, values);
    }
    return entities.map((entity) => ({
      id: entity.id,
      workspaceId: entity.workspaceId,
      email: entity.email ?? undefined,
      normalizedEmail: entity.normalizedEmail ?? undefined,
      displayName: entity.displayName,
      externalProvider: entity.externalProvider ?? undefined,
      externalSubject: entity.externalSubject ?? undefined,
      status: entity.status,
      version: entity.version,
      memberships: Object.freeze(membershipsByMember.get(entity.id) ?? []),
      notes: Object.freeze(notesByMember.get(entity.id) ?? []),
      archivedAt: entity.archivedAt ? new Date(entity.archivedAt) : undefined,
      createdAt: new Date(entity.createdAt),
      updatedAt: new Date(entity.updatedAt),
    }));
  }
}

function toCollection(entity: ResourceCollectionEntity): ResourceCollectionRecord {
  return {
    id: entity.id,
    workspaceId: entity.workspaceId,
    parentId: entity.parentId ?? undefined,
    name: entity.name,
    normalizedName: entity.normalizedName,
    description: entity.description ?? undefined,
    status: entity.status,
    version: entity.version,
    archivedAt: entity.archivedAt ? new Date(entity.archivedAt) : undefined,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}
