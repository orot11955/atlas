import { DomainError, ErrorCode } from '../../../core';

export const ProjectStatus = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  PAUSED: 'paused',
} as const;

export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];
export const PROJECT_STATUSES = Object.freeze(
  Object.values(ProjectStatus),
) as readonly ProjectStatus[];

export const RepositoryProvider = {
  GITEA: 'gitea',
  GITHUB: 'github',
  GITLAB: 'gitlab',
  OTHER: 'other',
} as const;

export type RepositoryProvider = (typeof RepositoryProvider)[keyof typeof RepositoryProvider];
export const REPOSITORY_PROVIDERS = Object.freeze(
  Object.values(RepositoryProvider),
) as readonly RepositoryProvider[];

export const RepositoryConnectionStatus = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
} as const;

export type RepositoryConnectionStatus =
  (typeof RepositoryConnectionStatus)[keyof typeof RepositoryConnectionStatus];

export const EnvironmentTier = {
  DEVELOPMENT: 'development',
  OTHER: 'other',
  PRODUCTION: 'production',
  STAGING: 'staging',
} as const;

export type EnvironmentTier = (typeof EnvironmentTier)[keyof typeof EnvironmentTier];
export const ENVIRONMENT_TIERS = Object.freeze(
  Object.values(EnvironmentTier),
) as readonly EnvironmentTier[];

export const EnvironmentStatus = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
} as const;

export type EnvironmentStatus = (typeof EnvironmentStatus)[keyof typeof EnvironmentStatus];
export const ENVIRONMENT_STATUSES = Object.freeze(
  Object.values(EnvironmentStatus),
) as readonly EnvironmentStatus[];

export const ServiceType = {
  API: 'api',
  DATABASE: 'database',
  OTHER: 'other',
  WEB: 'web',
  WORKER: 'worker',
} as const;

export type ServiceType = (typeof ServiceType)[keyof typeof ServiceType];
export const SERVICE_TYPES = Object.freeze(Object.values(ServiceType)) as readonly ServiceType[];

export const ServiceStatus = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  DISABLED: 'disabled',
} as const;

export type ServiceStatus = (typeof ServiceStatus)[keyof typeof ServiceStatus];
export const SERVICE_STATUSES = Object.freeze(
  Object.values(ServiceStatus),
) as readonly ServiceStatus[];

export const DeploymentStatus = {
  CANCELLED: 'cancelled',
  FAILED: 'failed',
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
} as const;

export type DeploymentStatus = (typeof DeploymentStatus)[keyof typeof DeploymentStatus];
export const DEPLOYMENT_STATUSES = Object.freeze(
  Object.values(DeploymentStatus),
) as readonly DeploymentStatus[];

export const DEPLOYMENT_TERMINAL_STATUSES = Object.freeze([
  DeploymentStatus.CANCELLED,
  DeploymentStatus.FAILED,
  DeploymentStatus.SUCCEEDED,
]) as readonly DeploymentStatus[];

export const HealthStatus = {
  HEALTHY: 'healthy',
  UNKNOWN: 'unknown',
  UNHEALTHY: 'unhealthy',
} as const;

export type HealthStatus = (typeof HealthStatus)[keyof typeof HealthStatus];
export const HEALTH_STATUSES = Object.freeze(
  Object.values(HealthStatus),
) as readonly HealthStatus[];

export interface ProjectRecord {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  version: number;
  siteIds: readonly string[];
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectEventRecord {
  id: string;
  projectId: string;
  type: string;
  message?: string;
  metadata: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  createdAt: Date;
}

export interface RepositoryConnectionRecord {
  id: string;
  projectId: string;
  provider: RepositoryProvider;
  repositoryUrl: string;
  repositoryFullName?: string;
  defaultBranch: string;
  externalId?: string;
  status: RepositoryConnectionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReleaseRecord {
  id: string;
  projectId: string;
  version: string;
  commitSha: string;
  sourceRef?: string;
  externalId?: string;
  metadata: Readonly<Record<string, unknown>>;
  createdAt: Date;
}

export interface EnvironmentRecord {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  tier: EnvironmentTier;
  status: EnvironmentStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceRecord {
  id: string;
  projectId: string;
  key: string;
  name: string;
  type: ServiceType;
  status: ServiceStatus;
  version: number;
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceEnvironmentRecord {
  id: string;
  serviceId: string;
  environmentId: string;
  healthUrl?: string;
  healthTimeoutMs: number;
  currentReleaseId?: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeploymentRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  serviceEnvironmentId: string;
  releaseId: string;
  externalId?: string;
  status: DeploymentStatus;
  startedAt?: Date;
  completedAt?: Date;
  failureCode?: string;
  failureMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeploymentEventRecord {
  id: string;
  deploymentId: string;
  externalEventId?: string;
  type: string;
  status?: DeploymentStatus;
  message?: string;
  metadata: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  createdAt: Date;
}

export interface HealthCheckRecord {
  id: string;
  serviceEnvironmentId: string;
  deploymentId?: string;
  status: HealthStatus;
  httpStatus?: number;
  latencyMs?: number;
  message?: string;
  checkedAt: Date;
  createdAt: Date;
}

export interface ProjectDetailRecord {
  project: Readonly<ProjectRecord>;
  repositories: readonly Readonly<RepositoryConnectionRecord>[];
  services: readonly Readonly<ServiceRecord>[];
  serviceEnvironments: readonly Readonly<ServiceEnvironmentRecord>[];
  timeline: readonly Readonly<ProjectEventRecord>[];
}

export interface DeploymentDetailRecord {
  deployment: Readonly<DeploymentRecord>;
  project: Readonly<ProjectRecord>;
  release: Readonly<ReleaseRecord>;
  service: Readonly<ServiceRecord>;
  environment: Readonly<EnvironmentRecord>;
  serviceEnvironment: Readonly<ServiceEnvironmentRecord>;
  events: readonly Readonly<DeploymentEventRecord>[];
  healthChecks: readonly Readonly<HealthCheckRecord>[];
  latestHealth?: Readonly<HealthCheckRecord>;
}

export interface IdempotencyRecord {
  apiClientId: string;
  operation: string;
  key: string;
  requestHash: string;
  resourceId?: string;
  responseStatus: number;
  responseJson: Readonly<Record<string, unknown>>;
  createdAt: Date;
}

export function normalizeProjectKey(value: string): string {
  return normalizeKey(value, 'key', 'Project');
}

export function normalizeEnvironmentKey(value: string): string {
  return normalizeKey(value, 'key', 'Environment');
}

export function normalizeServiceKey(value: string): string {
  return normalizeKey(value, 'key', 'Service');
}

export function normalizeProjectName(value: string): string {
  return normalizeName(value, 'name', 'Project');
}

export function normalizeEnvironmentName(value: string): string {
  return normalizeName(value, 'name', 'Environment');
}

export function normalizeServiceName(value: string): string {
  return normalizeName(value, 'name', 'Service');
}

export function normalizeProjectDescription(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\s+/gu, ' ');

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > 1_000) {
    throw validationError('description', 'Project description cannot exceed 1000 characters.');
  }

  return normalized;
}

export function normalizeProjectStatus(value: string): ProjectStatus {
  return normalizeEnum(value, PROJECT_STATUSES, 'status', 'Project status');
}

export function normalizeRepositoryProvider(value: string): RepositoryProvider {
  return normalizeEnum(value, REPOSITORY_PROVIDERS, 'provider', 'Repository provider');
}

export function normalizeEnvironmentTier(value: string): EnvironmentTier {
  return normalizeEnum(value, ENVIRONMENT_TIERS, 'tier', 'Environment tier');
}

export function normalizeServiceType(value: string): ServiceType {
  return normalizeEnum(value, SERVICE_TYPES, 'type', 'Service type');
}

export function normalizeDeploymentStatus(value: string): DeploymentStatus {
  return normalizeEnum(value, DEPLOYMENT_STATUSES, 'status', 'Deployment status');
}

export function normalizeTerminalDeploymentStatus(value: string): DeploymentStatus {
  const status = normalizeDeploymentStatus(value);

  if (!DEPLOYMENT_TERMINAL_STATUSES.includes(status)) {
    throw validationError(
      'status',
      'Completed Deployment status must be succeeded, failed or cancelled.',
    );
  }

  return status;
}

export function normalizeHealthStatus(value: string): HealthStatus {
  return normalizeEnum(value, HEALTH_STATUSES, 'status', 'Health status');
}

export function normalizeProjectSiteIds(values: readonly string[]): readonly string[] {
  if (values.length < 1 || values.length > 100) {
    throw validationError('siteIds', 'Project must be connected to between 1 and 100 Sites.');
  }

  const unique = [...new Set(values)];

  if (unique.length !== values.length || unique.some((value) => !isUuid(value))) {
    throw validationError('siteIds', 'Project Site identifiers are invalid or duplicated.');
  }

  return Object.freeze(unique.sort());
}

export function normalizeRepositoryUrl(value: string): string {
  const normalized = value.trim();
  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    throw validationError('repositoryUrl', 'Repository URL is invalid.');
  }

  const hasEmbeddedCredentials =
    parsed.password || (['http:', 'https:'].includes(parsed.protocol) && parsed.username);

  if (!['http:', 'https:', 'ssh:'].includes(parsed.protocol) || hasEmbeddedCredentials) {
    throw validationError(
      'repositoryUrl',
      'Repository URL must be an HTTP, HTTPS or SSH URL without embedded credentials.',
    );
  }

  if (normalized.length > 500) {
    throw validationError('repositoryUrl', 'Repository URL cannot exceed 500 characters.');
  }

  return normalized.replace(/\/$/u, '');
}

export function normalizeRepositoryFullName(value?: string): string | undefined {
  return normalizeOptionalText(value, 'repositoryFullName', 240, 'Repository full name');
}

export function normalizeBranchName(value: string): string {
  const normalized = value.trim();

  if (
    normalized.length < 1 ||
    normalized.length > 240 ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f ~^:?*\\[]/u.test(normalized) ||
    normalized.startsWith('/') ||
    normalized.endsWith('/') ||
    normalized.includes('..') ||
    normalized.includes('//') ||
    normalized.endsWith('.') ||
    normalized.endsWith('.lock')
  ) {
    throw validationError('defaultBranch', 'Repository default branch is invalid.');
  }

  return normalized;
}

export function normalizeReleaseVersion(value: string): string {
  const normalized = value.trim();

  if (normalized.length < 1 || normalized.length > 120 || /\s/u.test(normalized)) {
    throw validationError('version', 'Release version must contain 1 to 120 non-space characters.');
  }

  return normalized;
}

export function normalizeCommitSha(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!/^[0-9a-f]{7,64}$/u.test(normalized)) {
    throw validationError('commitSha', 'Release commit SHA is invalid.');
  }

  return normalized;
}

export function normalizeSourceRef(value?: string): string | undefined {
  return normalizeOptionalText(value, 'sourceRef', 240, 'Release source ref');
}

export function normalizeExternalId(value?: string, field = 'externalId'): string | undefined {
  return normalizeOptionalText(value, field, 240, 'External identifier');
}

export function normalizeEventType(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u.test(normalized) || normalized.length > 120) {
    throw validationError('type', 'Event type is invalid.');
  }

  return normalized;
}

export function normalizeEventMessage(value?: string): string | undefined {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > 2_000) {
    throw validationError('message', 'Event message cannot exceed 2000 characters.');
  }

  return normalized;
}

export function normalizeFailureCode(value?: string): string | undefined {
  const normalized = value?.trim().toUpperCase();

  if (!normalized) {
    return undefined;
  }

  if (!/^[A-Z0-9]+(?:[_-][A-Z0-9]+)*$/u.test(normalized) || normalized.length > 120) {
    throw validationError('failureCode', 'Deployment failure code is invalid.');
  }

  return normalized;
}

export function normalizeFailureMessage(value?: string): string | undefined {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > 2_000) {
    throw validationError(
      'failureMessage',
      'Deployment failure message cannot exceed 2000 characters.',
    );
  }

  return normalized;
}

export function normalizeHealthUrl(value?: string): string | undefined {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    throw validationError('healthUrl', 'Health URL is invalid.');
  }

  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    normalized.length > 500
  ) {
    throw validationError(
      'healthUrl',
      'Health URL must be an HTTP or HTTPS URL without credentials or fragments.',
    );
  }

  return parsed.toString();
}

export function normalizeHealthTimeoutMs(value?: number): number {
  if (value === undefined) {
    return 5_000;
  }

  if (!Number.isSafeInteger(value) || value < 500 || value > 60_000) {
    throw validationError('healthTimeoutMs', 'Health timeout must be between 500 and 60000 ms.');
  }

  return value;
}

export function normalizeHttpStatus(value?: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isSafeInteger(value) || value < 100 || value > 599) {
    throw validationError('httpStatus', 'Health HTTP status must be between 100 and 599.');
  }

  return value;
}

export function normalizeLatencyMs(value?: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value) || value < 0 || value > 3_600_000) {
    throw validationError('latencyMs', 'Health latency must be between 0 and 3600000 ms.');
  }

  return Math.round(value);
}

export function normalizeMetadata(
  value: Record<string, unknown> | undefined,
  field = 'metadata',
): Readonly<Record<string, unknown>> {
  const normalized = value ?? {};

  if (
    typeof normalized !== 'object' ||
    normalized === null ||
    Array.isArray(normalized) ||
    Buffer.byteLength(JSON.stringify(normalized), 'utf8') > 32_768
  ) {
    throw validationError(field, 'Metadata must be a JSON object smaller than 32768 bytes.');
  }

  return Object.freeze({ ...normalized });
}

export function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim();

  if (normalized.length < 8 || normalized.length > 200 || !/^[\x21-\x7e]+$/u.test(normalized)) {
    throw validationError(
      'Idempotency-Key',
      'Idempotency-Key must contain 8 to 200 visible ASCII characters.',
    );
  }

  return normalized;
}

export function normalizeDate(value: Date | undefined, field: string, fallback: Date): Date {
  if (!value) {
    return new Date(fallback);
  }

  if (Number.isNaN(value.getTime())) {
    throw validationError(field, `${field} is invalid.`);
  }

  return new Date(value);
}

export function assertProjectMutable(status: ProjectStatus): void {
  if (status === ProjectStatus.ARCHIVED) {
    throw new DomainError({
      code: ErrorCode.ACTION_NOT_ALLOWED,
      message: 'Archived Projects cannot be modified.',
    });
  }
}

export function assertDeploymentProgress(
  current: DeploymentStatus,
  target: DeploymentStatus,
): void {
  if (current === target) {
    return;
  }

  if (
    DEPLOYMENT_TERMINAL_STATUSES.includes(current) ||
    (target !== DeploymentStatus.RUNNING && !DEPLOYMENT_TERMINAL_STATUSES.includes(target))
  ) {
    throw new DomainError({
      code: ErrorCode.INVALID_STATE_TRANSITION,
      message: `Deployment status cannot change from ${current} to ${target}.`,
      details: { current, target },
    });
  }
}

export function assertPositiveVersion(value: number, field = 'version'): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw validationError(field, 'Version must be a positive integer.');
  }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function normalizeKey(value: string, field: string, label: string): string {
  const normalized = value.trim().toLowerCase();

  if (
    normalized.length < 2 ||
    normalized.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalized)
  ) {
    throw validationError(
      field,
      `${label} key must use lowercase letters, numbers and single hyphens.`,
    );
  }

  return normalized;
}

function normalizeName(value: string, field: string, label: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');

  if (normalized.length < 1 || normalized.length > 120) {
    throw validationError(field, `${label} name must contain between 1 and 120 characters.`);
  }

  return normalized;
}

function normalizeOptionalText(
  value: string | undefined,
  field: string,
  maxLength: number,
  label: string,
): string | undefined {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > maxLength) {
    throw validationError(field, `${label} cannot exceed ${maxLength} characters.`);
  }

  return normalized;
}

function normalizeEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  field: string,
  label: string,
): T {
  if (!allowed.includes(value as T)) {
    throw validationError(field, `${label} is invalid.`);
  }

  return value as T;
}

function validationError(field: string, message: string): DomainError {
  return new DomainError({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { field },
  });
}
