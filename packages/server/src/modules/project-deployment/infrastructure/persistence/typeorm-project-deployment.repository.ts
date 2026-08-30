import { In, type DataSource, type EntityManager } from 'typeorm';

import { SiteEntity } from '../../../site/infrastructure/persistence/site.entity';
import type {
  DeploymentDetailRecord,
  DeploymentEventRecord,
  DeploymentRecord,
  EnvironmentRecord,
  HealthCheckRecord,
  IdempotencyRecord,
  ProjectEventRecord,
  ProjectRecord,
  ReleaseRecord,
  RepositoryConnectionRecord,
  ServiceEnvironmentRecord,
  ServiceRecord,
} from '../../domain/project-deployment';
import type {
  DeploymentListQuery,
  ProjectDeploymentRepositoryPort,
  ProjectListQuery,
  UpdateDeploymentInput,
  UpdateProjectRecordInput,
  UpdateProjectStatusInput,
} from '../../ports/project-deployment.repository';
import {
  DeploymentEntity,
  DeploymentEventEntity,
  EnvironmentEntity,
  HealthCheckEntity,
  IdempotencyRecordEntity,
  ProjectEntity,
  ProjectEventEntity,
  ProjectSiteEntity,
  ReleaseEntity,
  RepositoryConnectionEntity,
  ServiceEntity,
  ServiceEnvironmentEntity,
} from './project-deployment.entities';

export class TypeOrmProjectDeploymentRepository implements ProjectDeploymentRepositoryPort<EntityManager> {
  public constructor(private readonly dataSource: DataSource) {}

  public async listProjects(
    workspaceId: string,
    query: ProjectListQuery,
  ): Promise<readonly ProjectRecord[]> {
    const builder = this.dataSource
      .getRepository(ProjectEntity)
      .createQueryBuilder('project')
      .where('project.workspace_id = :workspaceId', { workspaceId });

    if (query.status) {
      builder.andWhere('project.status = :status', { status: query.status });
    }

    if (query.search) {
      builder.andWhere(
        "(project.name ILIKE :search ESCAPE '\\' OR project.key ILIKE :search ESCAPE '\\')",
        { search: `%${escapeLike(query.search)}%` },
      );
    }

    const projects = await builder
      .orderBy('project.created_at', 'DESC')
      .addOrderBy('project.id', 'DESC')
      .take(100)
      .getMany();

    return this.hydrateProjects(projects, this.dataSource.manager);
  }

  public async findProjectById(
    workspaceId: string,
    projectId: string,
    transaction?: EntityManager,
  ): Promise<ProjectRecord | undefined> {
    const manager = transaction ?? this.dataSource.manager;
    const entity = await manager.getRepository(ProjectEntity).findOne({
      where: { id: projectId, workspaceId },
    });

    if (!entity) {
      return undefined;
    }

    const [record] = await this.hydrateProjects([entity], manager);
    return record;
  }

  public async findProjectByKey(
    workspaceId: string,
    key: string,
    transaction?: EntityManager,
  ): Promise<ProjectRecord | undefined> {
    const manager = transaction ?? this.dataSource.manager;
    const entity = await manager.getRepository(ProjectEntity).findOne({
      where: { workspaceId, key },
    });

    if (!entity) {
      return undefined;
    }

    const [record] = await this.hydrateProjects([entity], manager);
    return record;
  }

  public async findExistingSiteIds(
    workspaceId: string,
    siteIds: readonly string[],
    transaction?: EntityManager,
  ): Promise<readonly string[]> {
    if (siteIds.length === 0) {
      return [];
    }

    const entities = await (transaction ?? this.dataSource.manager).getRepository(SiteEntity).find({
      where: { workspaceId, id: In([...siteIds]) },
      select: { id: true },
    });

    return entities.map((entity) => entity.id).sort();
  }

  public async insertProject(project: ProjectRecord, transaction: EntityManager): Promise<void> {
    await transaction.getRepository(ProjectEntity).insert({
      id: project.id,
      workspaceId: project.workspaceId,
      key: project.key,
      name: project.name,
      description: project.description ?? null,
      status: project.status,
      version: project.version,
      archivedAt: project.archivedAt ?? null,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
    await this.replaceProjectSites(
      project.id,
      project.workspaceId,
      project.siteIds,
      project.createdAt,
      transaction,
    );
  }

  public async replaceProjectSites(
    projectId: string,
    workspaceId: string,
    siteIds: readonly string[],
    changedAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(ProjectSiteEntity).delete({ projectId });
    await transaction.getRepository(ProjectSiteEntity).insert(
      siteIds.map((siteId) => ({
        projectId,
        siteId,
        workspaceId,
        createdAt: changedAt,
      })),
    );
  }

  public async updateProject(
    workspaceId: string,
    projectId: string,
    input: UpdateProjectRecordInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(ProjectEntity).update(
      { id: projectId, workspaceId, version: input.expectedVersion },
      {
        name: input.name,
        description: input.description ?? null,
        version: input.nextVersion,
        updatedAt: input.updatedAt,
      },
    );

    return (result.affected ?? 0) === 1;
  }

  public async updateProjectStatus(
    workspaceId: string,
    projectId: string,
    input: UpdateProjectStatusInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(ProjectEntity).update(
      { id: projectId, workspaceId, version: input.expectedVersion },
      {
        status: input.status,
        version: input.nextVersion,
        archivedAt: input.archivedAt ?? null,
        updatedAt: input.updatedAt,
      },
    );

    return (result.affected ?? 0) === 1;
  }

  public async insertProjectEvent(
    event: ProjectEventRecord,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(ProjectEventEntity).insert({
      id: event.id,
      projectId: event.projectId,
      type: event.type,
      message: event.message ?? null,
      metadataJson: { ...event.metadata } as never,
      occurredAt: event.occurredAt,
      createdAt: event.createdAt,
    });
  }

  public async listProjectEvents(
    projectId: string,
    limit = 100,
  ): Promise<readonly ProjectEventRecord[]> {
    const entities = await this.dataSource.getRepository(ProjectEventEntity).find({
      where: { projectId },
      order: { occurredAt: 'DESC', id: 'DESC' },
      take: limit,
    });

    return entities.map(toProjectEvent);
  }

  public async insertRepositoryConnection(
    connection: RepositoryConnectionRecord,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(RepositoryConnectionEntity).insert({
      id: connection.id,
      projectId: connection.projectId,
      provider: connection.provider,
      repositoryUrl: connection.repositoryUrl,
      repositoryFullName: connection.repositoryFullName ?? null,
      defaultBranch: connection.defaultBranch,
      externalId: connection.externalId ?? null,
      status: connection.status,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    });
  }

  public async findRepositoryConnectionByUrl(
    projectId: string,
    repositoryUrl: string,
    transaction?: EntityManager,
  ): Promise<RepositoryConnectionRecord | undefined> {
    const entity = await (transaction ?? this.dataSource.manager)
      .getRepository(RepositoryConnectionEntity)
      .findOne({ where: { projectId, repositoryUrl } });

    return entity ? toRepositoryConnection(entity) : undefined;
  }

  public async listRepositoryConnections(
    projectId: string,
  ): Promise<readonly RepositoryConnectionRecord[]> {
    const entities = await this.dataSource.getRepository(RepositoryConnectionEntity).find({
      where: { projectId },
      order: { createdAt: 'ASC' },
    });

    return entities.map(toRepositoryConnection);
  }

  public async listEnvironments(workspaceId: string): Promise<readonly EnvironmentRecord[]> {
    const entities = await this.dataSource.getRepository(EnvironmentEntity).find({
      where: { workspaceId },
      order: { tier: 'ASC', name: 'ASC', id: 'ASC' },
    });

    return entities.map(toEnvironment);
  }

  public async findEnvironmentById(
    workspaceId: string,
    environmentId: string,
    transaction?: EntityManager,
  ): Promise<EnvironmentRecord | undefined> {
    const entity = await (transaction ?? this.dataSource.manager)
      .getRepository(EnvironmentEntity)
      .findOne({ where: { id: environmentId, workspaceId } });

    return entity ? toEnvironment(entity) : undefined;
  }

  public async findEnvironmentByKey(
    workspaceId: string,
    key: string,
    transaction?: EntityManager,
  ): Promise<EnvironmentRecord | undefined> {
    const entity = await (transaction ?? this.dataSource.manager)
      .getRepository(EnvironmentEntity)
      .findOne({ where: { workspaceId, key } });

    return entity ? toEnvironment(entity) : undefined;
  }

  public async insertEnvironment(
    environment: EnvironmentRecord,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(EnvironmentEntity).insert({
      id: environment.id,
      workspaceId: environment.workspaceId,
      key: environment.key,
      name: environment.name,
      tier: environment.tier,
      status: environment.status,
      version: environment.version,
      createdAt: environment.createdAt,
      updatedAt: environment.updatedAt,
    });
  }

  public async findServiceById(
    projectId: string,
    serviceId: string,
    transaction?: EntityManager,
  ): Promise<ServiceRecord | undefined> {
    const entity = await (transaction ?? this.dataSource.manager)
      .getRepository(ServiceEntity)
      .findOne({ where: { id: serviceId, projectId } });

    return entity ? toService(entity) : undefined;
  }

  public async findServiceByKey(
    projectId: string,
    key: string,
    transaction?: EntityManager,
  ): Promise<ServiceRecord | undefined> {
    const entity = await (transaction ?? this.dataSource.manager)
      .getRepository(ServiceEntity)
      .findOne({ where: { projectId, key } });

    return entity ? toService(entity) : undefined;
  }

  public async listServices(projectId: string): Promise<readonly ServiceRecord[]> {
    const entities = await this.dataSource.getRepository(ServiceEntity).find({
      where: { projectId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    return entities.map(toService);
  }

  public async insertService(service: ServiceRecord, transaction: EntityManager): Promise<void> {
    await transaction.getRepository(ServiceEntity).insert({
      id: service.id,
      projectId: service.projectId,
      key: service.key,
      name: service.name,
      type: service.type,
      status: service.status,
      version: service.version,
      archivedAt: service.archivedAt ?? null,
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
    });
  }

  public async findServiceEnvironment(
    serviceId: string,
    environmentId: string,
    transaction?: EntityManager,
  ): Promise<ServiceEnvironmentRecord | undefined> {
    const entity = await (transaction ?? this.dataSource.manager)
      .getRepository(ServiceEnvironmentEntity)
      .findOne({ where: { serviceId, environmentId } });

    return entity ? toServiceEnvironment(entity) : undefined;
  }

  public async findServiceEnvironmentById(
    serviceEnvironmentId: string,
    transaction?: EntityManager,
  ): Promise<ServiceEnvironmentRecord | undefined> {
    const entity = await (transaction ?? this.dataSource.manager)
      .getRepository(ServiceEnvironmentEntity)
      .findOne({ where: { id: serviceEnvironmentId } });

    return entity ? toServiceEnvironment(entity) : undefined;
  }

  public async findServiceEnvironmentByKeys(
    workspaceId: string,
    projectId: string,
    serviceKey: string,
    environmentKey: string,
    transaction?: EntityManager,
  ): Promise<
    | {
        service: ServiceRecord;
        environment: EnvironmentRecord;
        serviceEnvironment: ServiceEnvironmentRecord;
      }
    | undefined
  > {
    const manager = transaction ?? this.dataSource.manager;
    const serviceEntity = await manager.getRepository(ServiceEntity).findOne({
      where: { projectId, key: serviceKey },
    });
    const environmentEntity = await manager.getRepository(EnvironmentEntity).findOne({
      where: { workspaceId, key: environmentKey },
    });

    if (!serviceEntity || !environmentEntity) {
      return undefined;
    }

    const connection = await manager.getRepository(ServiceEnvironmentEntity).findOne({
      where: {
        serviceId: serviceEntity.id,
        environmentId: environmentEntity.id,
      },
    });

    if (!connection) {
      return undefined;
    }

    return {
      service: toService(serviceEntity),
      environment: toEnvironment(environmentEntity),
      serviceEnvironment: toServiceEnvironment(connection),
    };
  }

  public async listServiceEnvironments(
    projectId: string,
  ): Promise<readonly ServiceEnvironmentRecord[]> {
    const services = await this.dataSource.getRepository(ServiceEntity).find({
      where: { projectId },
      select: { id: true },
    });

    if (services.length === 0) {
      return [];
    }

    const entities = await this.dataSource.getRepository(ServiceEnvironmentEntity).find({
      where: { serviceId: In(services.map((service) => service.id)) },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    return entities.map(toServiceEnvironment);
  }

  public async insertServiceEnvironment(
    serviceEnvironment: ServiceEnvironmentRecord,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(ServiceEnvironmentEntity).insert({
      id: serviceEnvironment.id,
      serviceId: serviceEnvironment.serviceId,
      environmentId: serviceEnvironment.environmentId,
      healthUrl: serviceEnvironment.healthUrl ?? null,
      healthTimeoutMs: serviceEnvironment.healthTimeoutMs,
      currentReleaseId: serviceEnvironment.currentReleaseId ?? null,
      version: serviceEnvironment.version,
      createdAt: serviceEnvironment.createdAt,
      updatedAt: serviceEnvironment.updatedAt,
    });
  }

  public async updateCurrentRelease(
    serviceEnvironmentId: string,
    releaseId: string,
    updatedAt: Date,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(ServiceEnvironmentEntity).update(
      { id: serviceEnvironmentId },
      {
        currentReleaseId: releaseId,
        updatedAt,
        version: () => 'version + 1',
      },
    );
  }

  public async findReleaseById(
    projectId: string,
    releaseId: string,
    transaction?: EntityManager,
  ): Promise<ReleaseRecord | undefined> {
    const entity = await (transaction ?? this.dataSource.manager)
      .getRepository(ReleaseEntity)
      .findOne({ where: { id: releaseId, projectId } });

    return entity ? toRelease(entity) : undefined;
  }

  public async findReleaseByVersion(
    projectId: string,
    version: string,
    transaction?: EntityManager,
  ): Promise<ReleaseRecord | undefined> {
    const entity = await (transaction ?? this.dataSource.manager)
      .getRepository(ReleaseEntity)
      .findOne({ where: { projectId, version } });

    return entity ? toRelease(entity) : undefined;
  }

  public async insertRelease(release: ReleaseRecord, transaction: EntityManager): Promise<void> {
    await transaction.getRepository(ReleaseEntity).insert({
      id: release.id,
      projectId: release.projectId,
      version: release.version,
      commitSha: release.commitSha,
      sourceRef: release.sourceRef ?? null,
      externalId: release.externalId ?? null,
      metadataJson: { ...release.metadata } as never,
      createdAt: release.createdAt,
    });
  }

  public async listDeployments(
    workspaceId: string,
    query: DeploymentListQuery,
  ): Promise<readonly DeploymentRecord[]> {
    const builder = this.dataSource
      .getRepository(DeploymentEntity)
      .createQueryBuilder('deployment')
      .where('deployment.workspace_id = :workspaceId', { workspaceId });

    if (query.projectId) {
      builder.andWhere('deployment.project_id = :projectId', { projectId: query.projectId });
    }

    if (query.status) {
      builder.andWhere('deployment.status = :status', { status: query.status });
    }

    if (query.environmentId) {
      builder.innerJoin(
        ServiceEnvironmentEntity,
        'service_environment',
        'service_environment.id = deployment.service_environment_id AND service_environment.environment_id = :environmentId',
        { environmentId: query.environmentId },
      );
    }

    const entities = await builder
      .orderBy('deployment.created_at', 'DESC')
      .addOrderBy('deployment.id', 'DESC')
      .take(query.limit)
      .getMany();

    return entities.map(toDeployment);
  }

  public async findDeploymentById(
    workspaceId: string,
    deploymentId: string,
    transaction?: EntityManager,
  ): Promise<DeploymentRecord | undefined> {
    const entity = await (transaction ?? this.dataSource.manager)
      .getRepository(DeploymentEntity)
      .findOne({ where: { id: deploymentId, workspaceId } });

    return entity ? toDeployment(entity) : undefined;
  }

  public async insertDeployment(
    deployment: DeploymentRecord,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(DeploymentEntity).insert({
      id: deployment.id,
      workspaceId: deployment.workspaceId,
      projectId: deployment.projectId,
      serviceEnvironmentId: deployment.serviceEnvironmentId,
      releaseId: deployment.releaseId,
      externalId: deployment.externalId ?? null,
      status: deployment.status,
      startedAt: deployment.startedAt ?? null,
      completedAt: deployment.completedAt ?? null,
      failureCode: deployment.failureCode ?? null,
      failureMessage: deployment.failureMessage ?? null,
      createdAt: deployment.createdAt,
      updatedAt: deployment.updatedAt,
    });
  }

  public async updateDeployment(
    workspaceId: string,
    deploymentId: string,
    input: UpdateDeploymentInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(DeploymentEntity).update(
      { id: deploymentId, workspaceId },
      {
        status: input.status,
        startedAt: input.startedAt ?? null,
        completedAt: input.completedAt ?? null,
        failureCode: input.failureCode ?? null,
        failureMessage: input.failureMessage ?? null,
        updatedAt: input.updatedAt,
      },
    );

    return (result.affected ?? 0) === 1;
  }

  public async insertDeploymentEvent(
    event: DeploymentEventRecord,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(DeploymentEventEntity).insert({
      id: event.id,
      deploymentId: event.deploymentId,
      externalEventId: event.externalEventId ?? null,
      type: event.type,
      status: event.status ?? null,
      message: event.message ?? null,
      metadataJson: { ...event.metadata } as never,
      occurredAt: event.occurredAt,
      createdAt: event.createdAt,
    });
  }

  public async findDeploymentEventByExternalId(
    deploymentId: string,
    externalEventId: string,
    transaction?: EntityManager,
  ): Promise<DeploymentEventRecord | undefined> {
    const entity = await (transaction ?? this.dataSource.manager)
      .getRepository(DeploymentEventEntity)
      .findOne({ where: { deploymentId, externalEventId } });

    return entity ? toDeploymentEvent(entity) : undefined;
  }

  public async listDeploymentEvents(
    deploymentId: string,
  ): Promise<readonly DeploymentEventRecord[]> {
    const entities = await this.dataSource.getRepository(DeploymentEventEntity).find({
      where: { deploymentId },
      order: { occurredAt: 'ASC', id: 'ASC' },
    });

    return entities.map(toDeploymentEvent);
  }

  public async insertHealthCheck(
    healthCheck: HealthCheckRecord,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(HealthCheckEntity).insert({
      id: healthCheck.id,
      serviceEnvironmentId: healthCheck.serviceEnvironmentId,
      deploymentId: healthCheck.deploymentId ?? null,
      status: healthCheck.status,
      httpStatus: healthCheck.httpStatus ?? null,
      latencyMs: healthCheck.latencyMs ?? null,
      message: healthCheck.message ?? null,
      checkedAt: healthCheck.checkedAt,
      createdAt: healthCheck.createdAt,
    });
  }

  public async listHealthChecks(
    serviceEnvironmentId: string,
    deploymentId?: string,
  ): Promise<readonly HealthCheckRecord[]> {
    const entities = await this.dataSource.getRepository(HealthCheckEntity).find({
      where: {
        serviceEnvironmentId,
        ...(deploymentId ? { deploymentId } : {}),
      },
      order: { checkedAt: 'DESC', id: 'DESC' },
      take: 100,
    });

    return entities.map(toHealthCheck);
  }

  public async getDeploymentDetail(
    workspaceId: string,
    deploymentId: string,
  ): Promise<DeploymentDetailRecord | undefined> {
    const deployment = await this.findDeploymentById(workspaceId, deploymentId);

    if (!deployment) {
      return undefined;
    }

    const serviceEnvironment = await this.findServiceEnvironmentById(
      deployment.serviceEnvironmentId,
    );
    const project = await this.findProjectById(workspaceId, deployment.projectId);
    const release = await this.findReleaseById(deployment.projectId, deployment.releaseId);

    if (!serviceEnvironment || !project || !release) {
      return undefined;
    }

    const serviceEntity = await this.dataSource.getRepository(ServiceEntity).findOne({
      where: { id: serviceEnvironment.serviceId, projectId: project.id },
    });
    const environment = await this.findEnvironmentById(
      workspaceId,
      serviceEnvironment.environmentId,
    );

    if (!serviceEntity || !environment) {
      return undefined;
    }

    const [events, healthChecks] = await Promise.all([
      this.listDeploymentEvents(deployment.id),
      this.listHealthChecks(serviceEnvironment.id, deployment.id),
    ]);

    return {
      deployment,
      project,
      release,
      service: toService(serviceEntity),
      environment,
      serviceEnvironment,
      events,
      healthChecks,
      latestHealth: healthChecks[0],
    };
  }

  public async acquireIdempotencyLock(
    apiClientId: string,
    operation: string,
    key: string,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
      apiClientId,
      `${operation}:${key}`,
    ]);
  }

  public async findIdempotencyRecord(
    apiClientId: string,
    operation: string,
    key: string,
    transaction: EntityManager,
  ): Promise<IdempotencyRecord | undefined> {
    const entity = await transaction.getRepository(IdempotencyRecordEntity).findOne({
      where: { apiClientId, operation, key },
    });

    return entity ? toIdempotencyRecord(entity) : undefined;
  }

  public async insertIdempotencyRecord(
    record: IdempotencyRecord,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(IdempotencyRecordEntity).insert({
      apiClientId: record.apiClientId,
      operation: record.operation,
      key: record.key,
      requestHash: record.requestHash,
      resourceId: record.resourceId ?? null,
      responseStatus: record.responseStatus,
      responseJson: { ...record.responseJson } as never,
      createdAt: record.createdAt,
    });
  }

  private async hydrateProjects(
    entities: readonly ProjectEntity[],
    manager: EntityManager,
  ): Promise<ProjectRecord[]> {
    if (entities.length === 0) {
      return [];
    }

    const siteAccess = await manager.getRepository(ProjectSiteEntity).find({
      where: { projectId: In(entities.map((entity) => entity.id)) },
    });

    return entities.map((entity) =>
      toProject(
        entity,
        siteAccess
          .filter((access) => access.projectId === entity.id)
          .map((access) => access.siteId)
          .sort(),
      ),
    );
  }
}

function toProject(entity: ProjectEntity, siteIds: readonly string[]): ProjectRecord {
  return {
    id: entity.id,
    workspaceId: entity.workspaceId,
    key: entity.key,
    name: entity.name,
    description: entity.description ?? undefined,
    status: entity.status,
    version: entity.version,
    siteIds,
    archivedAt: entity.archivedAt ? new Date(entity.archivedAt) : undefined,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

function toProjectEvent(entity: ProjectEventEntity): ProjectEventRecord {
  return {
    id: entity.id,
    projectId: entity.projectId,
    type: entity.type,
    message: entity.message ?? undefined,
    metadata: Object.freeze({ ...entity.metadataJson }),
    occurredAt: new Date(entity.occurredAt),
    createdAt: new Date(entity.createdAt),
  };
}

function toRepositoryConnection(entity: RepositoryConnectionEntity): RepositoryConnectionRecord {
  return {
    id: entity.id,
    projectId: entity.projectId,
    provider: entity.provider,
    repositoryUrl: entity.repositoryUrl,
    repositoryFullName: entity.repositoryFullName ?? undefined,
    defaultBranch: entity.defaultBranch,
    externalId: entity.externalId ?? undefined,
    status: entity.status,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

function toRelease(entity: ReleaseEntity): ReleaseRecord {
  return {
    id: entity.id,
    projectId: entity.projectId,
    version: entity.version,
    commitSha: entity.commitSha,
    sourceRef: entity.sourceRef ?? undefined,
    externalId: entity.externalId ?? undefined,
    metadata: Object.freeze({ ...entity.metadataJson }),
    createdAt: new Date(entity.createdAt),
  };
}

function toEnvironment(entity: EnvironmentEntity): EnvironmentRecord {
  return {
    id: entity.id,
    workspaceId: entity.workspaceId,
    key: entity.key,
    name: entity.name,
    tier: entity.tier,
    status: entity.status,
    version: entity.version,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

function toService(entity: ServiceEntity): ServiceRecord {
  return {
    id: entity.id,
    projectId: entity.projectId,
    key: entity.key,
    name: entity.name,
    type: entity.type,
    status: entity.status,
    version: entity.version,
    archivedAt: entity.archivedAt ? new Date(entity.archivedAt) : undefined,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

function toServiceEnvironment(entity: ServiceEnvironmentEntity): ServiceEnvironmentRecord {
  return {
    id: entity.id,
    serviceId: entity.serviceId,
    environmentId: entity.environmentId,
    healthUrl: entity.healthUrl ?? undefined,
    healthTimeoutMs: entity.healthTimeoutMs,
    currentReleaseId: entity.currentReleaseId ?? undefined,
    version: entity.version,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

function toDeployment(entity: DeploymentEntity): DeploymentRecord {
  return {
    id: entity.id,
    workspaceId: entity.workspaceId,
    projectId: entity.projectId,
    serviceEnvironmentId: entity.serviceEnvironmentId,
    releaseId: entity.releaseId,
    externalId: entity.externalId ?? undefined,
    status: entity.status,
    startedAt: entity.startedAt ? new Date(entity.startedAt) : undefined,
    completedAt: entity.completedAt ? new Date(entity.completedAt) : undefined,
    failureCode: entity.failureCode ?? undefined,
    failureMessage: entity.failureMessage ?? undefined,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

function toDeploymentEvent(entity: DeploymentEventEntity): DeploymentEventRecord {
  return {
    id: entity.id,
    deploymentId: entity.deploymentId,
    externalEventId: entity.externalEventId ?? undefined,
    type: entity.type,
    status: entity.status ?? undefined,
    message: entity.message ?? undefined,
    metadata: Object.freeze({ ...entity.metadataJson }),
    occurredAt: new Date(entity.occurredAt),
    createdAt: new Date(entity.createdAt),
  };
}

function toHealthCheck(entity: HealthCheckEntity): HealthCheckRecord {
  return {
    id: entity.id,
    serviceEnvironmentId: entity.serviceEnvironmentId,
    deploymentId: entity.deploymentId ?? undefined,
    status: entity.status,
    httpStatus: entity.httpStatus ?? undefined,
    latencyMs: entity.latencyMs ?? undefined,
    message: entity.message ?? undefined,
    checkedAt: new Date(entity.checkedAt),
    createdAt: new Date(entity.createdAt),
  };
}

function toIdempotencyRecord(entity: IdempotencyRecordEntity): IdempotencyRecord {
  return {
    apiClientId: entity.apiClientId,
    operation: entity.operation,
    key: entity.key,
    requestHash: entity.requestHash,
    resourceId: entity.resourceId ?? undefined,
    responseStatus: entity.responseStatus,
    responseJson: Object.freeze({ ...entity.responseJson }),
    createdAt: new Date(entity.createdAt),
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}
