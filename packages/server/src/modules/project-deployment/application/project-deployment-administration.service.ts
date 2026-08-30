import type { AuditService, Clock, TransactionRunner } from '../../../core';
import { AuditResult, DomainError, ErrorCode, createUuidV7, systemClock } from '../../../core';
import {
  EnvironmentStatus,
  ProjectStatus,
  RepositoryConnectionStatus,
  ServiceStatus,
  assertPositiveVersion,
  assertProjectMutable,
  normalizeBranchName,
  normalizeEnvironmentKey,
  normalizeEnvironmentName,
  normalizeEnvironmentTier,
  normalizeExternalId,
  normalizeHealthTimeoutMs,
  normalizeHealthUrl,
  normalizeProjectDescription,
  normalizeProjectKey,
  normalizeProjectName,
  normalizeProjectSiteIds,
  normalizeRepositoryFullName,
  normalizeRepositoryProvider,
  normalizeRepositoryUrl,
  normalizeServiceKey,
  normalizeServiceName,
  normalizeServiceType,
  type DeploymentDetailRecord,
  type DeploymentRecord,
  type DeploymentStatus,
  type EnvironmentRecord,
  type EnvironmentTier,
  type ProjectDetailRecord,
  type ProjectRecord,
  type ProjectStatus as ProjectStatusType,
  type RepositoryConnectionRecord,
  type RepositoryProvider,
  type ServiceEnvironmentRecord,
  type ServiceRecord,
  type ServiceType,
} from '../domain/project-deployment';
import type { ProjectDeploymentRepositoryPort } from '../ports/project-deployment.repository';

export interface ProjectListInput {
  status?: ProjectStatusType;
  search?: string;
}

export interface CreateProjectInput {
  key: string;
  name: string;
  description?: string;
  siteIds: readonly string[];
}

export interface UpdateProjectInput {
  version: number;
  name: string;
  description?: string;
  siteIds: readonly string[];
}

export interface CreateRepositoryConnectionInput {
  provider: RepositoryProvider | string;
  repositoryUrl: string;
  repositoryFullName?: string;
  defaultBranch: string;
  externalId?: string;
}

export interface CreateEnvironmentInput {
  key: string;
  name: string;
  tier: EnvironmentTier | string;
}

export interface CreateServiceInput {
  key: string;
  name: string;
  type: ServiceType | string;
}

export interface ConnectServiceEnvironmentInput {
  environmentId: string;
  healthUrl?: string;
  healthTimeoutMs?: number;
}

export interface DeploymentListInput {
  projectId?: string;
  environmentId?: string;
  status?: DeploymentStatus;
  limit?: number;
}

export class ProjectDeploymentAdministrationService<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: ProjectDeploymentRepositoryPort<TTransaction>,
    private readonly auditService: AuditService<TTransaction>,
    private readonly clock: Clock = systemClock,
  ) {}

  public listProjects(
    workspaceId: string,
    input: ProjectListInput = {},
  ): Promise<readonly ProjectRecord[]> {
    return this.repository.listProjects(workspaceId, {
      status: input.status,
      search: normalizeSearch(input.search),
    });
  }

  public async getProject(
    workspaceId: string,
    projectId: string,
  ): Promise<Readonly<ProjectDetailRecord>> {
    const project = await this.repository.findProjectById(workspaceId, projectId);

    if (!project) {
      throw projectNotFoundError();
    }

    const [repositories, services, serviceEnvironments, timeline] = await Promise.all([
      this.repository.listRepositoryConnections(projectId),
      this.repository.listServices(projectId),
      this.repository.listServiceEnvironments(projectId),
      this.repository.listProjectEvents(projectId),
    ]);

    return Object.freeze({
      project: Object.freeze(project),
      repositories: Object.freeze(repositories.map((record) => Object.freeze(record))),
      services: Object.freeze(services.map((record) => Object.freeze(record))),
      serviceEnvironments: Object.freeze(
        serviceEnvironments.map((record) => Object.freeze(record)),
      ),
      timeline: Object.freeze(timeline.map((record) => Object.freeze(record))),
    });
  }

  public async createProject(
    workspaceId: string,
    input: CreateProjectInput,
  ): Promise<Readonly<ProjectRecord>> {
    const key = normalizeProjectKey(input.key);
    const name = normalizeProjectName(input.name);
    const description = normalizeProjectDescription(input.description);
    const siteIds = normalizeProjectSiteIds(input.siteIds);
    const now = this.clock.now();
    const project: ProjectRecord = {
      id: createUuidV7(now.getTime()),
      workspaceId,
      key,
      name,
      description,
      status: ProjectStatus.ACTIVE,
      version: 1,
      siteIds,
      createdAt: now,
      updatedAt: now,
    };

    await this.transactionRunner.run(async (transaction) => {
      if (await this.repository.findProjectByKey(workspaceId, key, transaction)) {
        throw new DomainError({
          code: ErrorCode.PROJECT_KEY_ALREADY_EXISTS,
          message: 'Project key is already in use in this Workspace.',
          details: { field: 'key' },
        });
      }

      await this.assertSitesExist(workspaceId, siteIds, transaction);
      await this.repository.insertProject(project, transaction);
      await this.repository.insertProjectEvent(
        createProjectEvent(project.id, 'project.created', now, {
          key,
          siteIds,
        }),
        transaction,
      );
      await this.auditService.record(
        {
          action: 'project.created',
          targetType: 'project',
          targetId: project.id,
          result: AuditResult.SUCCESS,
          metadata: { key, siteCount: siteIds.length },
        },
        transaction,
      );
    });

    return Object.freeze(project);
  }

  public async updateProject(
    workspaceId: string,
    projectId: string,
    input: UpdateProjectInput,
  ): Promise<Readonly<ProjectRecord>> {
    assertPositiveVersion(input.version);
    const name = normalizeProjectName(input.name);
    const description = normalizeProjectDescription(input.description);
    const siteIds = normalizeProjectSiteIds(input.siteIds);
    const now = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findProjectById(workspaceId, projectId, transaction);

      if (!current) {
        throw projectNotFoundError();
      }

      assertProjectMutable(current.status);
      await this.assertSitesExist(workspaceId, siteIds, transaction);
      const updated = await this.repository.updateProject(
        workspaceId,
        projectId,
        {
          name,
          description,
          expectedVersion: input.version,
          nextVersion: input.version + 1,
          updatedAt: now,
        },
        transaction,
      );

      if (!updated) {
        throw versionConflictError();
      }

      await this.repository.replaceProjectSites(projectId, workspaceId, siteIds, now, transaction);
      await this.repository.insertProjectEvent(
        createProjectEvent(projectId, 'project.updated', now, {
          changedFields: ['name', 'description', 'siteIds'],
          version: input.version + 1,
        }),
        transaction,
      );
      await this.auditService.record(
        {
          action: 'project.updated',
          targetType: 'project',
          targetId: projectId,
          result: AuditResult.SUCCESS,
          metadata: {
            changedFields: ['name', 'description', 'siteIds'],
            version: input.version + 1,
          },
        },
        transaction,
      );

      return Object.freeze({
        ...current,
        name,
        description,
        siteIds,
        version: input.version + 1,
        updatedAt: now,
      });
    });
  }

  public async changeProjectStatus(
    workspaceId: string,
    projectId: string,
    target: ProjectStatusType,
    version: number,
  ): Promise<Readonly<ProjectRecord>> {
    assertPositiveVersion(version);
    const now = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findProjectById(workspaceId, projectId, transaction);

      if (!current) {
        throw projectNotFoundError();
      }

      if (current.status === ProjectStatus.ARCHIVED && target !== ProjectStatus.ARCHIVED) {
        throw new DomainError({
          code: ErrorCode.ACTION_NOT_ALLOWED,
          message: 'Archived Projects cannot be reactivated.',
        });
      }

      if (current.status === target) {
        return Object.freeze(current);
      }

      const archivedAt = target === ProjectStatus.ARCHIVED ? now : undefined;
      const updated = await this.repository.updateProjectStatus(
        workspaceId,
        projectId,
        {
          status: target,
          expectedVersion: version,
          nextVersion: version + 1,
          archivedAt,
          updatedAt: now,
        },
        transaction,
      );

      if (!updated) {
        throw versionConflictError();
      }

      await this.repository.insertProjectEvent(
        createProjectEvent(projectId, 'project.status-changed', now, {
          previousStatus: current.status,
          status: target,
          version: version + 1,
        }),
        transaction,
      );
      await this.auditService.record(
        {
          action: 'project.status-changed',
          targetType: 'project',
          targetId: projectId,
          result: AuditResult.SUCCESS,
          metadata: {
            previousStatus: current.status,
            status: target,
            version: version + 1,
          },
        },
        transaction,
      );

      return Object.freeze({
        ...current,
        status: target,
        version: version + 1,
        archivedAt,
        updatedAt: now,
      });
    });
  }

  public async addRepositoryConnection(
    workspaceId: string,
    projectId: string,
    input: CreateRepositoryConnectionInput,
  ): Promise<Readonly<RepositoryConnectionRecord>> {
    const provider = normalizeRepositoryProvider(input.provider);
    const repositoryUrl = normalizeRepositoryUrl(input.repositoryUrl);
    const repositoryFullName = normalizeRepositoryFullName(input.repositoryFullName);
    const defaultBranch = normalizeBranchName(input.defaultBranch);
    const externalId = normalizeExternalId(input.externalId);
    const now = this.clock.now();
    const connection: RepositoryConnectionRecord = {
      id: createUuidV7(now.getTime()),
      projectId,
      provider,
      repositoryUrl,
      repositoryFullName,
      defaultBranch,
      externalId,
      status: RepositoryConnectionStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };

    await this.transactionRunner.run(async (transaction) => {
      const project = await this.repository.findProjectById(workspaceId, projectId, transaction);

      if (!project) {
        throw projectNotFoundError();
      }

      assertProjectMutable(project.status);

      if (
        await this.repository.findRepositoryConnectionByUrl(projectId, repositoryUrl, transaction)
      ) {
        throw new DomainError({
          code: ErrorCode.REPOSITORY_CONNECTION_ALREADY_EXISTS,
          message: 'Repository is already connected to this Project.',
          details: { field: 'repositoryUrl' },
        });
      }

      await this.repository.insertRepositoryConnection(connection, transaction);
      await this.repository.insertProjectEvent(
        createProjectEvent(projectId, 'repository.connected', now, {
          repositoryId: connection.id,
          provider,
          repositoryFullName,
        }),
        transaction,
      );
      await this.auditService.record(
        {
          action: 'repository.connected',
          targetType: 'repository-connection',
          targetId: connection.id,
          result: AuditResult.SUCCESS,
          metadata: { projectId, provider, repositoryFullName },
        },
        transaction,
      );
    });

    return Object.freeze(connection);
  }

  public async listEnvironments(
    workspaceId: string,
  ): Promise<readonly Readonly<EnvironmentRecord>[]> {
    const records = await this.repository.listEnvironments(workspaceId);
    return Object.freeze(records.map((record) => Object.freeze(record)));
  }

  public async createEnvironment(
    workspaceId: string,
    input: CreateEnvironmentInput,
  ): Promise<Readonly<EnvironmentRecord>> {
    const key = normalizeEnvironmentKey(input.key);
    const name = normalizeEnvironmentName(input.name);
    const tier = normalizeEnvironmentTier(input.tier);
    const now = this.clock.now();
    const environment: EnvironmentRecord = {
      id: createUuidV7(now.getTime()),
      workspaceId,
      key,
      name,
      tier,
      status: EnvironmentStatus.ACTIVE,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    await this.transactionRunner.run(async (transaction) => {
      if (await this.repository.findEnvironmentByKey(workspaceId, key, transaction)) {
        throw new DomainError({
          code: ErrorCode.ENVIRONMENT_KEY_ALREADY_EXISTS,
          message: 'Environment key is already in use in this Workspace.',
          details: { field: 'key' },
        });
      }

      await this.repository.insertEnvironment(environment, transaction);
      await this.auditService.record(
        {
          action: 'environment.created',
          targetType: 'environment',
          targetId: environment.id,
          result: AuditResult.SUCCESS,
          metadata: { key, tier },
        },
        transaction,
      );
    });

    return Object.freeze(environment);
  }

  public async addService(
    workspaceId: string,
    projectId: string,
    input: CreateServiceInput,
  ): Promise<Readonly<ServiceRecord>> {
    const key = normalizeServiceKey(input.key);
    const name = normalizeServiceName(input.name);
    const type = normalizeServiceType(input.type);
    const now = this.clock.now();
    const service: ServiceRecord = {
      id: createUuidV7(now.getTime()),
      projectId,
      key,
      name,
      type,
      status: ServiceStatus.ACTIVE,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    await this.transactionRunner.run(async (transaction) => {
      const project = await this.repository.findProjectById(workspaceId, projectId, transaction);

      if (!project) {
        throw projectNotFoundError();
      }

      assertProjectMutable(project.status);

      if (await this.repository.findServiceByKey(projectId, key, transaction)) {
        throw new DomainError({
          code: ErrorCode.SERVICE_KEY_ALREADY_EXISTS,
          message: 'Service key is already in use in this Project.',
          details: { field: 'key' },
        });
      }

      await this.repository.insertService(service, transaction);
      await this.repository.insertProjectEvent(
        createProjectEvent(projectId, 'service.created', now, {
          serviceId: service.id,
          key,
          type,
        }),
        transaction,
      );
      await this.auditService.record(
        {
          action: 'service.created',
          targetType: 'service',
          targetId: service.id,
          result: AuditResult.SUCCESS,
          metadata: { projectId, key, type },
        },
        transaction,
      );
    });

    return Object.freeze(service);
  }

  public async connectServiceEnvironment(
    workspaceId: string,
    projectId: string,
    serviceId: string,
    input: ConnectServiceEnvironmentInput,
  ): Promise<Readonly<ServiceEnvironmentRecord>> {
    const healthUrl = normalizeHealthUrl(input.healthUrl);
    const healthTimeoutMs = normalizeHealthTimeoutMs(input.healthTimeoutMs);
    const now = this.clock.now();
    const record: ServiceEnvironmentRecord = {
      id: createUuidV7(now.getTime()),
      serviceId,
      environmentId: input.environmentId,
      healthUrl,
      healthTimeoutMs,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    await this.transactionRunner.run(async (transaction) => {
      const [project, service, environment] = await Promise.all([
        this.repository.findProjectById(workspaceId, projectId, transaction),
        this.repository.findServiceById(projectId, serviceId, transaction),
        this.repository.findEnvironmentById(workspaceId, input.environmentId, transaction),
      ]);

      if (!project) {
        throw projectNotFoundError();
      }
      if (!service) {
        throw serviceNotFoundError();
      }
      if (!environment) {
        throw environmentNotFoundError();
      }

      assertProjectMutable(project.status);

      if (
        await this.repository.findServiceEnvironment(serviceId, input.environmentId, transaction)
      ) {
        throw new DomainError({
          code: ErrorCode.SERVICE_ENVIRONMENT_ALREADY_EXISTS,
          message: 'Service is already connected to this Environment.',
        });
      }

      await this.repository.insertServiceEnvironment(record, transaction);
      await this.repository.insertProjectEvent(
        createProjectEvent(projectId, 'service-environment.connected', now, {
          serviceEnvironmentId: record.id,
          serviceId,
          environmentId: input.environmentId,
          healthConfigured: Boolean(healthUrl),
        }),
        transaction,
      );
      await this.auditService.record(
        {
          action: 'service-environment.connected',
          targetType: 'service-environment',
          targetId: record.id,
          result: AuditResult.SUCCESS,
          metadata: {
            projectId,
            serviceId,
            environmentId: input.environmentId,
            healthConfigured: Boolean(healthUrl),
          },
        },
        transaction,
      );
    });

    return Object.freeze(record);
  }

  public async listDeployments(
    workspaceId: string,
    input: DeploymentListInput = {},
  ): Promise<readonly Readonly<DeploymentRecord>[]> {
    const limit = normalizeDeploymentLimit(input.limit);
    const records = await this.repository.listDeployments(workspaceId, {
      projectId: input.projectId,
      environmentId: input.environmentId,
      status: input.status,
      limit,
    });

    return Object.freeze(records.map((record) => Object.freeze(record)));
  }

  public async getDeployment(
    workspaceId: string,
    deploymentId: string,
  ): Promise<Readonly<DeploymentDetailRecord>> {
    const detail = await this.repository.getDeploymentDetail(workspaceId, deploymentId);

    if (!detail) {
      throw deploymentNotFoundError();
    }

    return Object.freeze(detail);
  }

  private async assertSitesExist(
    workspaceId: string,
    siteIds: readonly string[],
    transaction: TTransaction,
  ): Promise<void> {
    const existing = await this.repository.findExistingSiteIds(workspaceId, siteIds, transaction);

    if (existing.length !== siteIds.length) {
      throw new DomainError({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'One or more Project Sites do not exist in this Workspace.',
        details: { field: 'siteIds' },
      });
    }
  }
}

function createProjectEvent(
  projectId: string,
  type: string,
  occurredAt: Date,
  metadata: Record<string, unknown>,
) {
  return {
    id: createUuidV7(occurredAt.getTime()),
    projectId,
    type,
    metadata: Object.freeze({ ...metadata }),
    occurredAt,
    createdAt: occurredAt,
  };
}

function normalizeSearch(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\s+/gu, ' ');

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > 120) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Project search query cannot exceed 120 characters.',
      details: { field: 'search' },
    });
  }

  return normalized;
}

function normalizeDeploymentLimit(value?: number): number {
  if (value === undefined) {
    return 50;
  }

  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Deployment list limit must be between 1 and 100.',
      details: { field: 'limit' },
    });
  }

  return value;
}

function projectNotFoundError(): DomainError {
  return new DomainError({
    code: ErrorCode.PROJECT_NOT_FOUND,
    message: 'Project was not found.',
  });
}

function environmentNotFoundError(): DomainError {
  return new DomainError({
    code: ErrorCode.ENVIRONMENT_NOT_FOUND,
    message: 'Environment was not found.',
  });
}

function serviceNotFoundError(): DomainError {
  return new DomainError({
    code: ErrorCode.SERVICE_NOT_FOUND,
    message: 'Service was not found.',
  });
}

function deploymentNotFoundError(): DomainError {
  return new DomainError({
    code: ErrorCode.DEPLOYMENT_NOT_FOUND,
    message: 'Deployment was not found.',
  });
}

function versionConflictError(): DomainError {
  return new DomainError({
    code: ErrorCode.VERSION_CONFLICT,
    message: 'Project was changed by another request.',
  });
}
