export type ProjectStatus = 'active' | 'paused' | 'archived';
export type EnvironmentTier = 'development' | 'staging' | 'production' | 'other';
export type DeploymentStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown';

export interface ApiEnvelope<T> {
  data: T;
}

export interface Project {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  version: number;
  siteIds: readonly string[];
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryConnection {
  id: string;
  projectId: string;
  provider: 'gitea' | 'github' | 'gitlab' | 'other';
  repositoryUrl: string;
  repositoryFullName?: string;
  defaultBranch: string;
  externalId?: string;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

export interface Environment {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  tier: EnvironmentTier;
  status: 'active' | 'disabled';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Service {
  id: string;
  projectId: string;
  key: string;
  name: string;
  type: 'web' | 'api' | 'worker' | 'database' | 'other';
  status: 'active' | 'disabled' | 'archived';
  version: number;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceEnvironment {
  id: string;
  serviceId: string;
  environmentId: string;
  healthUrl?: string;
  healthTimeoutMs: number;
  currentReleaseId?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectEvent {
  id: string;
  projectId: string;
  type: string;
  message?: string;
  metadata: Readonly<Record<string, unknown>>;
  occurredAt: string;
  createdAt: string;
}

export interface ProjectDetail {
  project: Project;
  repositories: readonly RepositoryConnection[];
  services: readonly Service[];
  serviceEnvironments: readonly ServiceEnvironment[];
  timeline: readonly ProjectEvent[];
}

export interface Release {
  id: string;
  projectId: string;
  version: string;
  commitSha: string;
  sourceRef?: string;
  externalId?: string;
  metadata: Readonly<Record<string, unknown>>;
  createdAt: string;
}

export interface Deployment {
  id: string;
  workspaceId: string;
  projectId: string;
  serviceEnvironmentId: string;
  releaseId: string;
  externalId?: string;
  status: DeploymentStatus;
  startedAt?: string;
  completedAt?: string;
  failureCode?: string;
  failureMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentEvent {
  id: string;
  deploymentId: string;
  externalEventId?: string;
  type: string;
  status?: DeploymentStatus;
  message?: string;
  metadata: Readonly<Record<string, unknown>>;
  occurredAt: string;
  createdAt: string;
}

export interface HealthCheck {
  id: string;
  serviceEnvironmentId: string;
  deploymentId?: string;
  status: HealthStatus;
  httpStatus?: number;
  latencyMs?: number;
  message?: string;
  checkedAt: string;
  createdAt: string;
}

export interface DeploymentDetail {
  deployment: Deployment;
  project: Project;
  release: Release;
  service: Service;
  environment: Environment;
  serviceEnvironment: ServiceEnvironment;
  events: readonly DeploymentEvent[];
  healthChecks: readonly HealthCheck[];
  latestHealth?: HealthCheck;
}
