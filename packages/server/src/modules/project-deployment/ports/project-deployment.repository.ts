import type {
  DeploymentDetailRecord,
  DeploymentEventRecord,
  DeploymentRecord,
  DeploymentStatus,
  EnvironmentRecord,
  HealthCheckRecord,
  IdempotencyRecord,
  ProjectEventRecord,
  ProjectRecord,
  ProjectStatus,
  ReleaseRecord,
  RepositoryConnectionRecord,
  ServiceEnvironmentRecord,
  ServiceRecord,
} from '../domain/project-deployment';

export interface ProjectListQuery {
  status?: ProjectStatus;
  search?: string;
}

export interface DeploymentListQuery {
  projectId?: string;
  environmentId?: string;
  status?: DeploymentStatus;
  limit: number;
}

export interface UpdateProjectRecordInput {
  name: string;
  description?: string;
  expectedVersion: number;
  nextVersion: number;
  updatedAt: Date;
}

export interface UpdateProjectStatusInput {
  status: ProjectStatus;
  expectedVersion: number;
  nextVersion: number;
  archivedAt?: Date;
  updatedAt: Date;
}

export interface UpdateDeploymentInput {
  status: DeploymentStatus;
  startedAt?: Date;
  completedAt?: Date;
  failureCode?: string;
  failureMessage?: string;
  updatedAt: Date;
}

export interface ProjectDeploymentRepositoryPort<TTransaction = unknown> {
  listProjects(workspaceId: string, query: ProjectListQuery): Promise<readonly ProjectRecord[]>;
  findProjectById(
    workspaceId: string,
    projectId: string,
    transaction?: TTransaction,
  ): Promise<ProjectRecord | undefined>;
  findProjectByKey(
    workspaceId: string,
    key: string,
    transaction?: TTransaction,
  ): Promise<ProjectRecord | undefined>;
  findExistingSiteIds(
    workspaceId: string,
    siteIds: readonly string[],
    transaction?: TTransaction,
  ): Promise<readonly string[]>;
  insertProject(project: ProjectRecord, transaction: TTransaction): Promise<void>;
  replaceProjectSites(
    projectId: string,
    workspaceId: string,
    siteIds: readonly string[],
    changedAt: Date,
    transaction: TTransaction,
  ): Promise<void>;
  updateProject(
    workspaceId: string,
    projectId: string,
    input: UpdateProjectRecordInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  updateProjectStatus(
    workspaceId: string,
    projectId: string,
    input: UpdateProjectStatusInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  insertProjectEvent(event: ProjectEventRecord, transaction: TTransaction): Promise<void>;
  listProjectEvents(projectId: string, limit?: number): Promise<readonly ProjectEventRecord[]>;

  insertRepositoryConnection(
    connection: RepositoryConnectionRecord,
    transaction: TTransaction,
  ): Promise<void>;
  findRepositoryConnectionByUrl(
    projectId: string,
    repositoryUrl: string,
    transaction?: TTransaction,
  ): Promise<RepositoryConnectionRecord | undefined>;
  listRepositoryConnections(projectId: string): Promise<readonly RepositoryConnectionRecord[]>;

  listEnvironments(workspaceId: string): Promise<readonly EnvironmentRecord[]>;
  findEnvironmentById(
    workspaceId: string,
    environmentId: string,
    transaction?: TTransaction,
  ): Promise<EnvironmentRecord | undefined>;
  findEnvironmentByKey(
    workspaceId: string,
    key: string,
    transaction?: TTransaction,
  ): Promise<EnvironmentRecord | undefined>;
  insertEnvironment(environment: EnvironmentRecord, transaction: TTransaction): Promise<void>;

  findServiceById(
    projectId: string,
    serviceId: string,
    transaction?: TTransaction,
  ): Promise<ServiceRecord | undefined>;
  findServiceByKey(
    projectId: string,
    key: string,
    transaction?: TTransaction,
  ): Promise<ServiceRecord | undefined>;
  listServices(projectId: string): Promise<readonly ServiceRecord[]>;
  insertService(service: ServiceRecord, transaction: TTransaction): Promise<void>;

  findServiceEnvironment(
    serviceId: string,
    environmentId: string,
    transaction?: TTransaction,
  ): Promise<ServiceEnvironmentRecord | undefined>;
  findServiceEnvironmentById(
    serviceEnvironmentId: string,
    transaction?: TTransaction,
  ): Promise<ServiceEnvironmentRecord | undefined>;
  findServiceEnvironmentByKeys(
    workspaceId: string,
    projectId: string,
    serviceKey: string,
    environmentKey: string,
    transaction?: TTransaction,
  ): Promise<
    | {
        service: ServiceRecord;
        environment: EnvironmentRecord;
        serviceEnvironment: ServiceEnvironmentRecord;
      }
    | undefined
  >;
  listServiceEnvironments(projectId: string): Promise<readonly ServiceEnvironmentRecord[]>;
  insertServiceEnvironment(
    serviceEnvironment: ServiceEnvironmentRecord,
    transaction: TTransaction,
  ): Promise<void>;
  updateCurrentRelease(
    serviceEnvironmentId: string,
    releaseId: string,
    updatedAt: Date,
    transaction: TTransaction,
  ): Promise<void>;

  findReleaseById(
    projectId: string,
    releaseId: string,
    transaction?: TTransaction,
  ): Promise<ReleaseRecord | undefined>;
  findReleaseByVersion(
    projectId: string,
    version: string,
    transaction?: TTransaction,
  ): Promise<ReleaseRecord | undefined>;
  insertRelease(release: ReleaseRecord, transaction: TTransaction): Promise<void>;

  listDeployments(
    workspaceId: string,
    query: DeploymentListQuery,
  ): Promise<readonly DeploymentRecord[]>;
  findDeploymentById(
    workspaceId: string,
    deploymentId: string,
    transaction?: TTransaction,
  ): Promise<DeploymentRecord | undefined>;
  insertDeployment(deployment: DeploymentRecord, transaction: TTransaction): Promise<void>;
  updateDeployment(
    workspaceId: string,
    deploymentId: string,
    input: UpdateDeploymentInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  insertDeploymentEvent(event: DeploymentEventRecord, transaction: TTransaction): Promise<void>;
  findDeploymentEventByExternalId(
    deploymentId: string,
    externalEventId: string,
    transaction?: TTransaction,
  ): Promise<DeploymentEventRecord | undefined>;
  listDeploymentEvents(deploymentId: string): Promise<readonly DeploymentEventRecord[]>;
  insertHealthCheck(healthCheck: HealthCheckRecord, transaction: TTransaction): Promise<void>;
  listHealthChecks(
    serviceEnvironmentId: string,
    deploymentId?: string,
  ): Promise<readonly HealthCheckRecord[]>;
  getDeploymentDetail(
    workspaceId: string,
    deploymentId: string,
  ): Promise<DeploymentDetailRecord | undefined>;

  acquireIdempotencyLock(
    apiClientId: string,
    operation: string,
    key: string,
    transaction: TTransaction,
  ): Promise<void>;
  findIdempotencyRecord(
    apiClientId: string,
    operation: string,
    key: string,
    transaction: TTransaction,
  ): Promise<IdempotencyRecord | undefined>;
  insertIdempotencyRecord(record: IdempotencyRecord, transaction: TTransaction): Promise<void>;
}
