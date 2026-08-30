import type {
  DeploymentDetailRecord,
  DeploymentEventRecord,
  DeploymentRecord,
  EnvironmentRecord,
  HealthCheckRecord,
  ProjectDetailRecord,
  ProjectEventRecord,
  ProjectRecord,
  ReleaseRecord,
  RepositoryConnectionRecord,
  ServiceEnvironmentRecord,
  ServiceRecord,
} from '@atlas/server';

export function toProjectData(project: Readonly<ProjectRecord>) {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    key: project.key,
    name: project.name,
    ...(project.description ? { description: project.description } : {}),
    status: project.status,
    version: project.version,
    siteIds: project.siteIds,
    ...(project.archivedAt ? { archivedAt: project.archivedAt.toISOString() } : {}),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export function toProjectDetailData(detail: Readonly<ProjectDetailRecord>) {
  return {
    project: toProjectData(detail.project),
    repositories: detail.repositories.map(toRepositoryData),
    services: detail.services.map(toServiceData),
    serviceEnvironments: detail.serviceEnvironments.map(toServiceEnvironmentData),
    timeline: detail.timeline.map(toProjectEventData),
  };
}

export function toRepositoryData(connection: Readonly<RepositoryConnectionRecord>) {
  return {
    id: connection.id,
    projectId: connection.projectId,
    provider: connection.provider,
    repositoryUrl: connection.repositoryUrl,
    ...(connection.repositoryFullName ? { repositoryFullName: connection.repositoryFullName } : {}),
    defaultBranch: connection.defaultBranch,
    ...(connection.externalId ? { externalId: connection.externalId } : {}),
    status: connection.status,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
}

export function toEnvironmentData(environment: Readonly<EnvironmentRecord>) {
  return {
    id: environment.id,
    workspaceId: environment.workspaceId,
    key: environment.key,
    name: environment.name,
    tier: environment.tier,
    status: environment.status,
    version: environment.version,
    createdAt: environment.createdAt.toISOString(),
    updatedAt: environment.updatedAt.toISOString(),
  };
}

export function toServiceData(service: Readonly<ServiceRecord>) {
  return {
    id: service.id,
    projectId: service.projectId,
    key: service.key,
    name: service.name,
    type: service.type,
    status: service.status,
    version: service.version,
    ...(service.archivedAt ? { archivedAt: service.archivedAt.toISOString() } : {}),
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString(),
  };
}

export function toServiceEnvironmentData(record: Readonly<ServiceEnvironmentRecord>) {
  return {
    id: record.id,
    serviceId: record.serviceId,
    environmentId: record.environmentId,
    ...(record.healthUrl ? { healthUrl: record.healthUrl } : {}),
    healthTimeoutMs: record.healthTimeoutMs,
    ...(record.currentReleaseId ? { currentReleaseId: record.currentReleaseId } : {}),
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toReleaseData(release: Readonly<ReleaseRecord>) {
  return {
    id: release.id,
    projectId: release.projectId,
    version: release.version,
    commitSha: release.commitSha,
    ...(release.sourceRef ? { sourceRef: release.sourceRef } : {}),
    ...(release.externalId ? { externalId: release.externalId } : {}),
    metadata: release.metadata,
    createdAt: release.createdAt.toISOString(),
  };
}

export function toDeploymentData(deployment: Readonly<DeploymentRecord>) {
  return {
    id: deployment.id,
    workspaceId: deployment.workspaceId,
    projectId: deployment.projectId,
    serviceEnvironmentId: deployment.serviceEnvironmentId,
    releaseId: deployment.releaseId,
    ...(deployment.externalId ? { externalId: deployment.externalId } : {}),
    status: deployment.status,
    ...(deployment.startedAt ? { startedAt: deployment.startedAt.toISOString() } : {}),
    ...(deployment.completedAt ? { completedAt: deployment.completedAt.toISOString() } : {}),
    ...(deployment.failureCode ? { failureCode: deployment.failureCode } : {}),
    ...(deployment.failureMessage ? { failureMessage: deployment.failureMessage } : {}),
    createdAt: deployment.createdAt.toISOString(),
    updatedAt: deployment.updatedAt.toISOString(),
  };
}

export function toDeploymentEventData(event: Readonly<DeploymentEventRecord>) {
  return {
    id: event.id,
    deploymentId: event.deploymentId,
    ...(event.externalEventId ? { externalEventId: event.externalEventId } : {}),
    type: event.type,
    ...(event.status ? { status: event.status } : {}),
    ...(event.message ? { message: event.message } : {}),
    metadata: event.metadata,
    occurredAt: event.occurredAt.toISOString(),
    createdAt: event.createdAt.toISOString(),
  };
}

export function toHealthCheckData(health: Readonly<HealthCheckRecord>) {
  return {
    id: health.id,
    serviceEnvironmentId: health.serviceEnvironmentId,
    ...(health.deploymentId ? { deploymentId: health.deploymentId } : {}),
    status: health.status,
    ...(health.httpStatus !== undefined ? { httpStatus: health.httpStatus } : {}),
    ...(health.latencyMs !== undefined ? { latencyMs: health.latencyMs } : {}),
    ...(health.message ? { message: health.message } : {}),
    checkedAt: health.checkedAt.toISOString(),
    createdAt: health.createdAt.toISOString(),
  };
}

export function toProjectEventData(event: Readonly<ProjectEventRecord>) {
  return {
    id: event.id,
    projectId: event.projectId,
    type: event.type,
    ...(event.message ? { message: event.message } : {}),
    metadata: event.metadata,
    occurredAt: event.occurredAt.toISOString(),
    createdAt: event.createdAt.toISOString(),
  };
}

export function toDeploymentDetailData(detail: Readonly<DeploymentDetailRecord>) {
  return {
    deployment: toDeploymentData(detail.deployment),
    project: toProjectData(detail.project),
    release: toReleaseData(detail.release),
    service: toServiceData(detail.service),
    environment: toEnvironmentData(detail.environment),
    serviceEnvironment: toServiceEnvironmentData(detail.serviceEnvironment),
    events: detail.events.map(toDeploymentEventData),
    healthChecks: detail.healthChecks.map(toHealthCheckData),
    ...(detail.latestHealth ? { latestHealth: toHealthCheckData(detail.latestHealth) } : {}),
  };
}
