import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type {
  MemberStatus,
  ResourceCollectionStatus,
  ResourceRelationTargetType,
  ResourceRelationType,
  ResourceSensitivity,
  ResourceStatus,
  ResourceType,
  ResourceVisibility,
  SiteMembershipStatus,
} from '../../domain/resource-member';

@Entity({ name: 'resource_collections' })
@Index('idx_resource_collections_workspace_parent', ['workspaceId', 'parentId'])
export class ResourceCollectionEntity {
  @PrimaryColumn({ type: 'uuid' }) public id!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) public workspaceId!: string;
  @Column({ name: 'parent_id', type: 'uuid', nullable: true }) public parentId!: string | null;
  @Column({ type: 'varchar', length: 120 }) public name!: string;
  @Column({ name: 'normalized_name', type: 'varchar', length: 120 }) public normalizedName!: string;
  @Column({ type: 'varchar', length: 500, nullable: true }) public description!: string | null;
  @Column({ type: 'varchar', length: 16 }) public status!: ResourceCollectionStatus;
  @Column({ type: 'integer' }) public version!: number;
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true }) public archivedAt!: Date | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) public createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) public updatedAt!: Date;
}

@Entity({ name: 'resource_tags' })
@Index('uq_resource_tags_workspace_name', ['workspaceId', 'normalizedName'], { unique: true })
export class ResourceTagEntity {
  @PrimaryColumn({ type: 'uuid' }) public id!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) public workspaceId!: string;
  @Column({ type: 'varchar', length: 64 }) public name!: string;
  @Column({ name: 'normalized_name', type: 'varchar', length: 64 }) public normalizedName!: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) public createdAt!: Date;
}

@Entity({ name: 'resources' })
@Index('idx_resources_workspace_status_updated', ['workspaceId', 'status', 'updatedAt'])
@Index('idx_resources_workspace_collection', ['workspaceId', 'collectionId'])
export class ResourceEntity {
  @PrimaryColumn({ type: 'uuid' }) public id!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) public workspaceId!: string;
  @Column({ name: 'collection_id', type: 'uuid', nullable: true }) public collectionId!: string | null;
  @Column({ type: 'varchar', length: 24 }) public type!: ResourceType;
  @Column({ type: 'varchar', length: 200 }) public title!: string;
  @Column({ type: 'varchar', length: 1_000, nullable: true }) public summary!: string | null;
  @Column({ name: 'body_markdown', type: 'text', nullable: true }) public bodyMarkdown!: string | null;
  @Column({ name: 'source_url', type: 'varchar', length: 2_000, nullable: true }) public sourceUrl!: string | null;
  @Column({ type: 'varchar', length: 24 }) public visibility!: ResourceVisibility;
  @Column({ type: 'varchar', length: 24 }) public sensitivity!: ResourceSensitivity;
  @Column({ name: 'secret_reference', type: 'varchar', length: 300, nullable: true }) public secretReference!: string | null;
  @Column({ type: 'varchar', length: 16 }) public status!: ResourceStatus;
  @Column({ type: 'integer' }) public version!: number;
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true }) public archivedAt!: Date | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) public createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) public updatedAt!: Date;
}

@Entity({ name: 'resource_tag_assignments' })
export class ResourceTagAssignmentEntity {
  @PrimaryColumn({ name: 'resource_id', type: 'uuid' }) public resourceId!: string;
  @PrimaryColumn({ name: 'tag_id', type: 'uuid' }) public tagId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) public workspaceId!: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) public createdAt!: Date;
}

@Entity({ name: 'resource_relations' })
@Index('idx_resource_relations_target', ['workspaceId', 'targetType', 'targetId'])
export class ResourceRelationEntity {
  @PrimaryColumn({ type: 'uuid' }) public id!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) public workspaceId!: string;
  @Column({ name: 'resource_id', type: 'uuid' }) public resourceId!: string;
  @Column({ name: 'target_type', type: 'varchar', length: 24 }) public targetType!: ResourceRelationTargetType;
  @Column({ name: 'target_id', type: 'uuid' }) public targetId!: string;
  @Column({ name: 'relation_type', type: 'varchar', length: 32 }) public relationType!: ResourceRelationType;
  @Column({ name: 'created_at', type: 'timestamptz' }) public createdAt!: Date;
}

@Entity({ name: 'resource_assets' })
export class ResourceAssetEntity {
  @PrimaryColumn({ type: 'uuid' }) public id!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) public workspaceId!: string;
  @Column({ name: 'resource_id', type: 'uuid' }) public resourceId!: string;
  @Column({ name: 'asset_id', type: 'uuid' }) public assetId!: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) public createdAt!: Date;
}

@Entity({ name: 'members' })
@Index('idx_members_workspace_status_created', ['workspaceId', 'status', 'createdAt'])
export class MemberEntity {
  @PrimaryColumn({ type: 'uuid' }) public id!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) public workspaceId!: string;
  @Column({ type: 'varchar', length: 320, nullable: true }) public email!: string | null;
  @Column({ name: 'normalized_email', type: 'varchar', length: 320, nullable: true }) public normalizedEmail!: string | null;
  @Column({ name: 'display_name', type: 'varchar', length: 120 }) public displayName!: string;
  @Column({ name: 'external_provider', type: 'varchar', length: 64, nullable: true }) public externalProvider!: string | null;
  @Column({ name: 'external_subject', type: 'varchar', length: 240, nullable: true }) public externalSubject!: string | null;
  @Column({ type: 'varchar', length: 16 }) public status!: MemberStatus;
  @Column({ type: 'integer' }) public version!: number;
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true }) public archivedAt!: Date | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) public createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) public updatedAt!: Date;
}

@Entity({ name: 'site_memberships' })
@Index('idx_site_memberships_site_status', ['siteId', 'status'])
export class SiteMembershipEntity {
  @PrimaryColumn({ name: 'member_id', type: 'uuid' }) public memberId!: string;
  @PrimaryColumn({ name: 'site_id', type: 'uuid' }) public siteId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) public workspaceId!: string;
  @Column({ type: 'varchar', length: 24 }) public status!: SiteMembershipStatus;
  @Column({ type: 'integer' }) public version!: number;
  @Column({ name: 'joined_at', type: 'timestamptz', nullable: true }) public joinedAt!: Date | null;
  @Column({ name: 'updated_at', type: 'timestamptz' }) public updatedAt!: Date;
}

@Entity({ name: 'member_admin_notes' })
@Index('idx_member_admin_notes_member_created', ['memberId', 'createdAt'])
export class MemberAdminNoteEntity {
  @PrimaryColumn({ type: 'uuid' }) public id!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) public workspaceId!: string;
  @Column({ name: 'member_id', type: 'uuid' }) public memberId!: string;
  @Column({ type: 'varchar', length: 2_000 }) public body!: string;
  @Column({ name: 'created_by_admin_account_id', type: 'uuid' }) public createdByAdminAccountId!: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) public createdAt!: Date;
}
