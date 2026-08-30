import { createAdminApiClient } from '../../lib/api';
import type {
  ApiEnvelope,
  Deployment,
  DeploymentDetail,
  DeploymentStatus,
  Environment,
  EnvironmentTier,
  Project,
  ProjectDetail,
  ProjectStatus,
  RepositoryConnection,
  Service,
  ServiceEnvironment,
} from './project-deployment-types';

function client() {
  return createAdminApiClient();
}

export async function loadProjects(
  input: {
    status?: ProjectStatus;
    search?: string;
  } = {},
): Promise<readonly Project[]> {
  const query = new URLSearchParams();
  if (input.status) query.set('status', input.status);
  if (input.search?.trim()) query.set('search', input.search.trim());
  const suffix = query.toString();
  const response = await client().get<ApiEnvelope<readonly Project[]>>(
    suffix ? `/projects?${suffix}` : '/projects',
  );
  return response.data;
}

export async function loadProject(projectId: string): Promise<ProjectDetail> {
  const response = await client().get<ApiEnvelope<ProjectDetail>>(
    `/projects/${encodeURIComponent(projectId)}`,
  );
  return response.data;
}

export async function createProject(input: {
  key: string;
  name: string;
  description?: string;
  siteIds: readonly string[];
}): Promise<Project> {
  const response = await client().post<ApiEnvelope<Project>>('/projects', input);
  return response.data;
}

export async function updateProject(
  projectId: string,
  input: {
    version: number;
    name: string;
    description?: string;
    siteIds: readonly string[];
  },
): Promise<Project> {
  const response = await client().patch<ApiEnvelope<Project>>(
    `/projects/${encodeURIComponent(projectId)}`,
    input,
  );
  return response.data;
}

export async function changeProjectStatus(
  projectId: string,
  status: ProjectStatus,
  version: number,
): Promise<Project> {
  const action = status === 'active' ? 'activate' : status === 'paused' ? 'pause' : 'archive';
  const response = await client().post<ApiEnvelope<Project>>(
    `/projects/${encodeURIComponent(projectId)}/${action}`,
    { version },
  );
  return response.data;
}

export async function connectRepository(
  projectId: string,
  input: {
    provider: 'gitea' | 'github' | 'gitlab' | 'other';
    repositoryUrl: string;
    repositoryFullName?: string;
    defaultBranch: string;
    externalId?: string;
  },
): Promise<RepositoryConnection> {
  const response = await client().post<ApiEnvelope<RepositoryConnection>>(
    `/projects/${encodeURIComponent(projectId)}/repositories`,
    input,
  );
  return response.data;
}

export async function loadEnvironments(): Promise<readonly Environment[]> {
  const response = await client().get<ApiEnvelope<readonly Environment[]>>('/environments');
  return response.data;
}

export async function createEnvironment(input: {
  key: string;
  name: string;
  tier: EnvironmentTier;
}): Promise<Environment> {
  const response = await client().post<ApiEnvelope<Environment>>('/environments', input);
  return response.data;
}

export async function createService(
  projectId: string,
  input: {
    key: string;
    name: string;
    type: 'web' | 'api' | 'worker' | 'database' | 'other';
  },
): Promise<Service> {
  const response = await client().post<ApiEnvelope<Service>>(
    `/projects/${encodeURIComponent(projectId)}/services`,
    input,
  );
  return response.data;
}

export async function connectServiceEnvironment(
  projectId: string,
  serviceId: string,
  input: {
    environmentId: string;
    healthUrl?: string;
    healthTimeoutMs?: number;
  },
): Promise<ServiceEnvironment> {
  const response = await client().post<ApiEnvelope<ServiceEnvironment>>(
    `/projects/${encodeURIComponent(projectId)}/services/${encodeURIComponent(serviceId)}/environments`,
    input,
  );
  return response.data;
}

export async function loadDeployments(
  input: {
    projectId?: string;
    environmentId?: string;
    status?: DeploymentStatus;
    limit?: number;
  } = {},
): Promise<readonly Deployment[]> {
  const query = new URLSearchParams();
  if (input.projectId) query.set('projectId', input.projectId);
  if (input.environmentId) query.set('environmentId', input.environmentId);
  if (input.status) query.set('status', input.status);
  if (input.limit !== undefined) query.set('limit', String(input.limit));
  const suffix = query.toString();
  const response = await client().get<ApiEnvelope<readonly Deployment[]>>(
    suffix ? `/deployments?${suffix}` : '/deployments',
  );
  return response.data;
}

export async function loadDeployment(deploymentId: string): Promise<DeploymentDetail> {
  const response = await client().get<ApiEnvelope<DeploymentDetail>>(
    `/deployments/${encodeURIComponent(deploymentId)}`,
  );
  return response.data;
}
