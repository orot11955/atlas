import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type {
  DeploymentStatus,
  EnvironmentStatus,
  EnvironmentTier,
  HealthStatus,
  ProjectStatus,
  RepositoryConnectionStatus,
  RepositoryProvider,
  ServiceStatus,
  ServiceType,
} from '../../domain/project-deployment';

@Entity({ name: 'projects' })
@Index('uq_projects_workspace_key', ['workspaceId', 'key'], { unique: true })
@Index('idx_projects_workspace_status_created', ['workspaceId', 'status', 'createdAt'])
export class ProjectEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ type: 'varchar', length: 64 })
  public key!: string;

  @Column({ type: 'varchar', length: 120 })
  public name!: string;

  @Column({ type: 'varchar', length: 1_000, nullable: true })
  public description!: string | null;

  @Column({ type: 'varchar', length: 24 })
  public status!: ProjectStatus;

  @Column({ type: 'integer', default: 1 })
  public version!: number;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  public archivedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}

@Entity({ name: 'project_sites' })
@Index('uq_project_sites_project_site', ['projectId', 'siteId'], { unique: true })
@Index('idx_project_sites_workspace_site', ['workspaceId', 'siteId'])
export class ProjectSiteEntity {
  @PrimaryColumn({ name: 'project_id', type: 'uuid' })
  public projectId!: string;

  @PrimaryColumn({ name: 'site_id', type: 'uuid' })
  public siteId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}

@Entity({ name: 'project_events' })
@Index('idx_project_events_project_occurred', ['projectId', 'occurredAt'])
export class ProjectEventEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  public projectId!: string;

  @Column({ type: 'varchar', length: 120 })
  public type!: string;

  @Column({ type: 'varchar', length: 2_000, nullable: true })
  public message!: string | null;

  @Column({ name: 'metadata_json', type: 'jsonb', default: {} })
  public metadataJson!: Record<string, unknown>;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  public occurredAt!: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}

@Entity({ name: 'repository_connections' })
@Index('uq_repository_connections_project_url', ['projectId', 'repositoryUrl'], { unique: true })
@Index('idx_repository_connections_project_status', ['projectId', 'status'])
export class RepositoryConnectionEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  public projectId!: string;

  @Column({ type: 'varchar', length: 24 })
  public provider!: RepositoryProvider;

  @Column({ name: 'repository_url', type: 'varchar', length: 500 })
  public repositoryUrl!: string;

  @Column({ name: 'repository_full_name', type: 'varchar', length: 240, nullable: true })
  public repositoryFullName!: string | null;

  @Column({ name: 'default_branch', type: 'varchar', length: 240 })
  public defaultBranch!: string;

  @Column({ name: 'external_id', type: 'varchar', length: 240, nullable: true })
  public externalId!: string | null;

  @Column({ type: 'varchar', length: 24 })
  public status!: RepositoryConnectionStatus;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}

@Entity({ name: 'releases' })
@Index('uq_releases_project_version', ['projectId', 'version'], { unique: true })
@Index('idx_releases_project_created', ['projectId', 'createdAt'])
export class ReleaseEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  public projectId!: string;

  @Column({ type: 'varchar', length: 120 })
  public version!: string;

  @Column({ name: 'commit_sha', type: 'varchar', length: 64 })
  public commitSha!: string;

  @Column({ name: 'source_ref', type: 'varchar', length: 240, nullable: true })
  public sourceRef!: string | null;

  @Column({ name: 'external_id', type: 'varchar', length: 240, nullable: true })
  public externalId!: string | null;

  @Column({ name: 'metadata_json', type: 'jsonb', default: {} })
  public metadataJson!: Record<string, unknown>;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}

@Entity({ name: 'environments' })
@Index('uq_environments_workspace_key', ['workspaceId', 'key'], { unique: true })
@Index('idx_environments_workspace_status', ['workspaceId', 'status'])
export class EnvironmentEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ type: 'varchar', length: 64 })
  public key!: string;

  @Column({ type: 'varchar', length: 120 })
  public name!: string;

  @Column({ type: 'varchar', length: 24 })
  public tier!: EnvironmentTier;

  @Column({ type: 'varchar', length: 24 })
  public status!: EnvironmentStatus;

  @Column({ type: 'integer', default: 1 })
  public version!: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}

@Entity({ name: 'services' })
@Index('uq_services_project_key', ['projectId', 'key'], { unique: true })
@Index('idx_services_project_status', ['projectId', 'status'])
export class ServiceEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  public projectId!: string;

  @Column({ type: 'varchar', length: 64 })
  public key!: string;

  @Column({ type: 'varchar', length: 120 })
  public name!: string;

  @Column({ type: 'varchar', length: 24 })
  public type!: ServiceType;

  @Column({ type: 'varchar', length: 24 })
  public status!: ServiceStatus;

  @Column({ type: 'integer', default: 1 })
  public version!: number;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  public archivedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}

@Entity({ name: 'service_environments' })
@Index('uq_service_environments_service_environment', ['serviceId', 'environmentId'], {
  unique: true,
})
@Index('idx_service_environments_environment', ['environmentId'])
export class ServiceEnvironmentEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'service_id', type: 'uuid' })
  public serviceId!: string;

  @Column({ name: 'environment_id', type: 'uuid' })
  public environmentId!: string;

  @Column({ name: 'health_url', type: 'varchar', length: 500, nullable: true })
  public healthUrl!: string | null;

  @Column({ name: 'health_timeout_ms', type: 'integer', default: 5_000 })
  public healthTimeoutMs!: number;

  @Column({ name: 'current_release_id', type: 'uuid', nullable: true })
  public currentReleaseId!: string | null;

  @Column({ type: 'integer', default: 1 })
  public version!: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}

@Entity({ name: 'deployments' })
@Index('idx_deployments_workspace_created', ['workspaceId', 'createdAt'])
@Index('idx_deployments_project_status_created', ['projectId', 'status', 'createdAt'])
@Index('idx_deployments_service_environment_created', ['serviceEnvironmentId', 'createdAt'])
export class DeploymentEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  public projectId!: string;

  @Column({ name: 'service_environment_id', type: 'uuid' })
  public serviceEnvironmentId!: string;

  @Column({ name: 'release_id', type: 'uuid' })
  public releaseId!: string;

  @Column({ name: 'external_id', type: 'varchar', length: 240, nullable: true })
  public externalId!: string | null;

  @Column({ type: 'varchar', length: 24 })
  public status!: DeploymentStatus;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  public startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  public completedAt!: Date | null;

  @Column({ name: 'failure_code', type: 'varchar', length: 120, nullable: true })
  public failureCode!: string | null;

  @Column({ name: 'failure_message', type: 'varchar', length: 2_000, nullable: true })
  public failureMessage!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}

@Entity({ name: 'deployment_events' })
@Index('idx_deployment_events_deployment_occurred', ['deploymentId', 'occurredAt'])
export class DeploymentEventEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'deployment_id', type: 'uuid' })
  public deploymentId!: string;

  @Column({ name: 'external_event_id', type: 'varchar', length: 240, nullable: true })
  public externalEventId!: string | null;

  @Column({ type: 'varchar', length: 120 })
  public type!: string;

  @Column({ type: 'varchar', length: 24, nullable: true })
  public status!: DeploymentStatus | null;

  @Column({ type: 'varchar', length: 2_000, nullable: true })
  public message!: string | null;

  @Column({ name: 'metadata_json', type: 'jsonb', default: {} })
  public metadataJson!: Record<string, unknown>;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  public occurredAt!: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}

@Entity({ name: 'health_checks' })
@Index('idx_health_checks_service_environment_checked', ['serviceEnvironmentId', 'checkedAt'])
@Index('idx_health_checks_deployment_checked', ['deploymentId', 'checkedAt'])
export class HealthCheckEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'service_environment_id', type: 'uuid' })
  public serviceEnvironmentId!: string;

  @Column({ name: 'deployment_id', type: 'uuid', nullable: true })
  public deploymentId!: string | null;

  @Column({ type: 'varchar', length: 24 })
  public status!: HealthStatus;

  @Column({ name: 'http_status', type: 'integer', nullable: true })
  public httpStatus!: number | null;

  @Column({ name: 'latency_ms', type: 'integer', nullable: true })
  public latencyMs!: number | null;

  @Column({ type: 'varchar', length: 2_000, nullable: true })
  public message!: string | null;

  @Column({ name: 'checked_at', type: 'timestamptz' })
  public checkedAt!: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}

@Entity({ name: 'idempotency_records' })
@Index('uq_idempotency_records_client_operation_key', ['apiClientId', 'operation', 'key'], {
  unique: true,
})
export class IdempotencyRecordEntity {
  @PrimaryColumn({ name: 'api_client_id', type: 'uuid' })
  public apiClientId!: string;

  @PrimaryColumn({ type: 'varchar', length: 120 })
  public operation!: string;

  @PrimaryColumn({ type: 'varchar', length: 200 })
  public key!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  public requestHash!: string;

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  public resourceId!: string | null;

  @Column({ name: 'response_status', type: 'integer' })
  public responseStatus!: number;

  @Column({ name: 'response_json', type: 'jsonb' })
  public responseJson!: Record<string, unknown>;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}
