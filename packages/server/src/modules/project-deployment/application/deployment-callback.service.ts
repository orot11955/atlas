import { createHash } from 'node:crypto';

import type { AuditService, Clock, TransactionRunner } from '../../../core';
import { AuditResult, DomainError, ErrorCode, createUuidV7, systemClock } from '../../../core';
import { ApiClientType, type ApiClientPrincipal } from '../../api-client';
import {
  DeploymentStatus,
  EnvironmentStatus,
  ProjectStatus,
  ServiceStatus,
  assertDeploymentProgress,
  normalizeCommitSha,
  normalizeDate,
  normalizeDeploymentStatus,
  normalizeEventMessage,
  normalizeEventType,
  normalizeExternalId,
  normalizeFailureCode,
  normalizeFailureMessage,
  normalizeHealthStatus,
  normalizeHttpStatus,
  normalizeIdempotencyKey,
  normalizeLatencyMs,
  normalizeMetadata,
  normalizeProjectKey,
  normalizeReleaseVersion,
  normalizeServiceKey,
  normalizeSourceRef,
  normalizeEnvironmentKey,
  normalizeTerminalDeploymentStatus,
  type DeploymentEventRecord,
  type DeploymentRecord,
  type DeploymentStatus as DeploymentStatusType,
  type HealthCheckRecord,
  type HealthStatus,
  type ReleaseRecord,
} from '../domain/project-deployment';
import type { ProjectDeploymentRepositoryPort } from '../ports/project-deployment.repository';

export interface CreateReleaseCallbackInput {
  version: string;
  commitSha: string;
  sourceRef?: string;
  externalId?: string;
  metadata?: Record<string, unknown>;
}

export interface StartDeploymentCallbackInput {
  serviceKey: string;
  environmentKey: string;
  releaseVersion: string;
  externalId?: string;
  startedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface DeploymentEventCallbackInput {
  externalEventId?: string;
  type: string;
  status?: DeploymentStatusType | string;
  message?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}

export interface CompleteDeploymentCallbackInput {
  status: DeploymentStatusType | string;
  failureCode?: string;
  failureMessage?: string;
  completedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface RecordHealthCallbackInput {
  status: HealthStatus | string;
  httpStatus?: number;
  latencyMs?: number;
  message?: string;
  checkedAt?: Date;
}

export interface StartDeploymentResult {
  deployment: Readonly<DeploymentRecord>;
  replayed: boolean;
}

export class DeploymentCallbackService<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: ProjectDeploymentRepositoryPort<TTransaction>,
    private readonly auditService: AuditService<TTransaction>,
    private readonly clock: Clock = systemClock,
  ) {}

  public async createRelease(
    principal: Readonly<ApiClientPrincipal>,
    projectKeyInput: string,
    input: CreateReleaseCallbackInput,
  ): Promise<Readonly<ReleaseRecord>> {
    assertIntegrationPrincipal(principal);
    const projectKey = normalizeProjectKey(projectKeyInput);
    const version = normalizeReleaseVersion(input.version);
    const commitSha = normalizeCommitSha(input.commitSha);
    const sourceRef = normalizeSourceRef(input.sourceRef);
    const externalId = normalizeExternalId(input.externalId);
    const metadata = normalizeMetadata(input.metadata);
    const now = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const project = await this.requireAccessibleProject(principal, projectKey, transaction);
      const existing = await this.repository.findReleaseByVersion(project.id, version, transaction);

      if (existing) {
        if (
          existing.commitSha !== commitSha ||
          existing.sourceRef !== sourceRef ||
          existing.externalId !== externalId
        ) {
          throw new DomainError({
            code: ErrorCode.RELEASE_ALREADY_EXISTS,
            message: 'Release version already exists with different source data.',
            details: { field: 'version' },
          });
        }

        return Object.freeze(existing);
      }

      const release: ReleaseRecord = {
        id: createUuidV7(now.getTime()),
        projectId: project.id,
        version,
        commitSha,
        sourceRef,
        externalId,
        metadata,
        createdAt: now,
      };

      await this.repository.insertRelease(release, transaction);
      await this.repository.insertProjectEvent(
        createProjectEvent(project.id, 'release.created', now, {
          releaseId: release.id,
          version,
          commitSha,
        }),
        transaction,
      );
      await this.auditService.record(
        {
          action: 'release.created',
          targetType: 'release',
          targetId: release.id,
          result: AuditResult.SUCCESS,
          metadata: { projectId: project.id, version, commitSha },
        },
        transaction,
      );

      return Object.freeze(release);
    });
  }

  public async startDeployment(
    principal: Readonly<ApiClientPrincipal>,
    projectKeyInput: string,
    idempotencyKeyInput: string,
    input: StartDeploymentCallbackInput,
  ): Promise<Readonly<StartDeploymentResult>> {
    assertIntegrationPrincipal(principal);
    const projectKey = normalizeProjectKey(projectKeyInput);
    const idempotencyKey = normalizeIdempotencyKey(idempotencyKeyInput);
    const serviceKey = normalizeServiceKey(input.serviceKey);
    const environmentKey = normalizeEnvironmentKey(input.environmentKey);
    const releaseVersion = normalizeReleaseVersion(input.releaseVersion);
    const externalId = normalizeExternalId(input.externalId);
    const startedAt = normalizeDate(input.startedAt, 'startedAt', this.clock.now());
    const metadata = normalizeMetadata(input.metadata);
    const requestHash = hashRequest({
      projectKey,
      serviceKey,
      environmentKey,
      releaseVersion,
      externalId,
      startedAt: startedAt.toISOString(),
      metadata,
    });
    const operation = 'deployment.start';

    return this.transactionRunner.run(async (transaction) => {
      await this.repository.acquireIdempotencyLock(
        principal.apiClientId,
        operation,
        idempotencyKey,
        transaction,
      );
      const previous = await this.repository.findIdempotencyRecord(
        principal.apiClientId,
        operation,
        idempotencyKey,
        transaction,
      );

      if (previous) {
        if (previous.requestHash !== requestHash) {
          throw idempotencyConflictError();
        }

        const deploymentId = previous.resourceId;
        const deployment = deploymentId
          ? await this.repository.findDeploymentById(
              principal.workspaceId,
              deploymentId,
              transaction,
            )
          : undefined;

        if (!deployment) {
          throw new DomainError({
            code: ErrorCode.INTERNAL_ERROR,
            message: 'Stored idempotent Deployment response is unavailable.',
          });
        }

        return Object.freeze({ deployment: Object.freeze(deployment), replayed: true });
      }

      const project = await this.requireAccessibleProject(principal, projectKey, transaction);
      const release = await this.repository.findReleaseByVersion(
        project.id,
        releaseVersion,
        transaction,
      );
      const target = await this.repository.findServiceEnvironmentByKeys(
        principal.workspaceId,
        project.id,
        serviceKey,
        environmentKey,
        transaction,
      );

      if (!release) {
        throw new DomainError({
          code: ErrorCode.RELEASE_NOT_FOUND,
          message: 'Release was not found for this Project.',
        });
      }
      if (!target) {
        throw new DomainError({
          code: ErrorCode.SERVICE_ENVIRONMENT_NOT_FOUND,
          message: 'Service Environment was not found for this Project.',
        });
      }
      if (
        target.service.status !== ServiceStatus.ACTIVE ||
        target.environment.status !== EnvironmentStatus.ACTIVE
      ) {
        throw new DomainError({
          code: ErrorCode.ACTION_NOT_ALLOWED,
          message: 'Deployment target Service and Environment must be active.',
        });
      }

      const now = this.clock.now();
      const deployment: DeploymentRecord = {
        id: createUuidV7(now.getTime()),
        workspaceId: principal.workspaceId,
        projectId: project.id,
        serviceEnvironmentId: target.serviceEnvironment.id,
        releaseId: release.id,
        externalId,
        status: DeploymentStatus.RUNNING,
        startedAt,
        createdAt: now,
        updatedAt: now,
      };

      await this.repository.insertDeployment(deployment, transaction);
      await this.repository.insertDeploymentEvent(
        createDeploymentEvent(deployment.id, 'deployment.started', now, {
          status: DeploymentStatus.RUNNING,
          message: 'Deployment started.',
          metadata,
        }),
        transaction,
      );
      await this.repository.insertProjectEvent(
        createProjectEvent(project.id, 'deployment.started', now, {
          deploymentId: deployment.id,
          releaseId: release.id,
          serviceId: target.service.id,
          environmentId: target.environment.id,
        }),
        transaction,
      );
      await this.repository.insertIdempotencyRecord(
        {
          apiClientId: principal.apiClientId,
          operation,
          key: idempotencyKey,
          requestHash,
          resourceId: deployment.id,
          responseStatus: 201,
          responseJson: Object.freeze({ deploymentId: deployment.id }),
          createdAt: now,
        },
        transaction,
      );
      await this.auditService.record(
        {
          action: 'deployment.started',
          targetType: 'deployment',
          targetId: deployment.id,
          result: AuditResult.SUCCESS,
          metadata: {
            projectId: project.id,
            releaseId: release.id,
            serviceEnvironmentId: target.serviceEnvironment.id,
          },
        },
        transaction,
      );

      return Object.freeze({ deployment: Object.freeze(deployment), replayed: false });
    });
  }

  public async addDeploymentEvent(
    principal: Readonly<ApiClientPrincipal>,
    deploymentId: string,
    input: DeploymentEventCallbackInput,
  ): Promise<Readonly<DeploymentEventRecord>> {
    assertIntegrationPrincipal(principal);
    const externalEventId = normalizeExternalId(input.externalEventId, 'externalEventId');
    const type = normalizeEventType(input.type);
    const status = input.status ? normalizeDeploymentStatus(input.status) : undefined;
    const message = normalizeEventMessage(input.message);
    const metadata = normalizeMetadata(input.metadata);
    const occurredAt = normalizeDate(input.occurredAt, 'occurredAt', this.clock.now());

    return this.transactionRunner.run(async (transaction) => {
      const deployment = await this.requireAccessibleDeployment(
        principal,
        deploymentId,
        transaction,
      );

      if (externalEventId) {
        const existing = await this.repository.findDeploymentEventByExternalId(
          deployment.id,
          externalEventId,
          transaction,
        );

        if (existing) {
          return Object.freeze(existing);
        }
      }

      if (status) {
        assertDeploymentProgress(deployment.status, status);

        if (status !== deployment.status) {
          const updated = await this.repository.updateDeployment(
            principal.workspaceId,
            deployment.id,
            {
              status,
              startedAt: deployment.startedAt ?? occurredAt,
              updatedAt: occurredAt,
            },
            transaction,
          );

          if (!updated) {
            throw deploymentNotFoundError();
          }
        }
      }

      const event = createDeploymentEvent(deployment.id, type, occurredAt, {
        externalEventId,
        status,
        message,
        metadata,
      });
      await this.repository.insertDeploymentEvent(event, transaction);
      await this.repository.insertProjectEvent(
        createProjectEvent(deployment.projectId, 'deployment.event-recorded', occurredAt, {
          deploymentId: deployment.id,
          deploymentEventId: event.id,
          type,
          status,
        }),
        transaction,
      );

      return Object.freeze(event);
    });
  }

  public async completeDeployment(
    principal: Readonly<ApiClientPrincipal>,
    deploymentId: string,
    input: CompleteDeploymentCallbackInput,
  ): Promise<Readonly<DeploymentRecord>> {
    assertIntegrationPrincipal(principal);
    const status = normalizeTerminalDeploymentStatus(input.status);
    const failureCode = normalizeFailureCode(input.failureCode);
    const failureMessage = normalizeFailureMessage(input.failureMessage);
    const metadata = normalizeMetadata(input.metadata);
    const completedAt = normalizeDate(input.completedAt, 'completedAt', this.clock.now());

    if (status !== DeploymentStatus.FAILED && (failureCode || failureMessage)) {
      throw new DomainError({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Failure details are only allowed for failed Deployments.',
        details: { field: 'failureCode' },
      });
    }

    return this.transactionRunner.run(async (transaction) => {
      const current = await this.requireAccessibleDeployment(principal, deploymentId, transaction);

      if (current.status === status) {
        return Object.freeze(current);
      }

      assertDeploymentProgress(current.status, status);
      const updated = await this.repository.updateDeployment(
        principal.workspaceId,
        current.id,
        {
          status,
          startedAt: current.startedAt,
          completedAt,
          failureCode,
          failureMessage,
          updatedAt: completedAt,
        },
        transaction,
      );

      if (!updated) {
        throw deploymentNotFoundError();
      }

      if (status === DeploymentStatus.SUCCEEDED) {
        await this.repository.updateCurrentRelease(
          current.serviceEnvironmentId,
          current.releaseId,
          completedAt,
          transaction,
        );
      }

      await this.repository.insertDeploymentEvent(
        createDeploymentEvent(current.id, 'deployment.completed', completedAt, {
          status,
          message:
            status === DeploymentStatus.SUCCEEDED
              ? 'Deployment succeeded.'
              : status === DeploymentStatus.CANCELLED
                ? 'Deployment was cancelled.'
                : (failureMessage ?? 'Deployment failed.'),
          metadata,
        }),
        transaction,
      );
      await this.repository.insertProjectEvent(
        createProjectEvent(current.projectId, 'deployment.completed', completedAt, {
          deploymentId: current.id,
          releaseId: current.releaseId,
          status,
          failureCode,
        }),
        transaction,
      );
      await this.auditService.record(
        {
          action: 'deployment.completed',
          targetType: 'deployment',
          targetId: current.id,
          result: status === DeploymentStatus.SUCCEEDED ? AuditResult.SUCCESS : AuditResult.FAILURE,
          metadata: {
            projectId: current.projectId,
            releaseId: current.releaseId,
            status,
            failureCode,
          },
        },
        transaction,
      );

      return Object.freeze({
        ...current,
        status,
        completedAt,
        failureCode,
        failureMessage,
        updatedAt: completedAt,
      });
    });
  }

  public async recordHealth(
    principal: Readonly<ApiClientPrincipal>,
    deploymentId: string,
    input: RecordHealthCallbackInput,
  ): Promise<Readonly<HealthCheckRecord>> {
    assertIntegrationPrincipal(principal);
    const status = normalizeHealthStatus(input.status);
    const httpStatus = normalizeHttpStatus(input.httpStatus);
    const latencyMs = normalizeLatencyMs(input.latencyMs);
    const message = normalizeEventMessage(input.message);
    const checkedAt = normalizeDate(input.checkedAt, 'checkedAt', this.clock.now());

    return this.transactionRunner.run(async (transaction) => {
      const deployment = await this.requireAccessibleDeployment(
        principal,
        deploymentId,
        transaction,
      );
      const serviceEnvironment = await this.repository.findServiceEnvironmentById(
        deployment.serviceEnvironmentId,
        transaction,
      );

      if (!serviceEnvironment) {
        throw new DomainError({
          code: ErrorCode.SERVICE_ENVIRONMENT_NOT_FOUND,
          message: 'Service Environment was not found.',
        });
      }
      if (!serviceEnvironment.healthUrl) {
        throw new DomainError({
          code: ErrorCode.ACTION_NOT_ALLOWED,
          message: 'Health callback requires a pre-registered Service Environment Health URL.',
        });
      }

      const healthCheck: HealthCheckRecord = {
        id: createUuidV7(checkedAt.getTime()),
        serviceEnvironmentId: serviceEnvironment.id,
        deploymentId: deployment.id,
        status,
        httpStatus,
        latencyMs,
        message,
        checkedAt,
        createdAt: this.clock.now(),
      };

      await this.repository.insertHealthCheck(healthCheck, transaction);
      await this.repository.insertProjectEvent(
        createProjectEvent(deployment.projectId, 'health.checked', checkedAt, {
          deploymentId: deployment.id,
          serviceEnvironmentId: serviceEnvironment.id,
          status,
          httpStatus,
          latencyMs,
        }),
        transaction,
      );
      await this.auditService.record(
        {
          action: 'health.checked',
          targetType: 'health-check',
          targetId: healthCheck.id,
          result: status === 'healthy' ? AuditResult.SUCCESS : AuditResult.FAILURE,
          metadata: {
            deploymentId: deployment.id,
            serviceEnvironmentId: serviceEnvironment.id,
            status,
            httpStatus,
            latencyMs,
          },
        },
        transaction,
      );

      return Object.freeze(healthCheck);
    });
  }

  private async requireAccessibleProject(
    principal: Readonly<ApiClientPrincipal>,
    projectKey: string,
    transaction: TTransaction,
  ) {
    const project = await this.repository.findProjectByKey(
      principal.workspaceId,
      projectKey,
      transaction,
    );

    if (!project) {
      throw projectNotFoundError();
    }
    if (project.status !== ProjectStatus.ACTIVE) {
      throw new DomainError({
        code: ErrorCode.ACTION_NOT_ALLOWED,
        message: 'Integration callbacks require an active Project.',
      });
    }

    assertProjectSiteAccess(principal, project.siteIds);
    return project;
  }

  private async requireAccessibleDeployment(
    principal: Readonly<ApiClientPrincipal>,
    deploymentId: string,
    transaction: TTransaction,
  ): Promise<DeploymentRecord> {
    const deployment = await this.repository.findDeploymentById(
      principal.workspaceId,
      deploymentId,
      transaction,
    );

    if (!deployment) {
      throw deploymentNotFoundError();
    }

    const project = await this.repository.findProjectById(
      principal.workspaceId,
      deployment.projectId,
      transaction,
    );

    if (!project) {
      throw projectNotFoundError();
    }

    assertProjectSiteAccess(principal, project.siteIds);
    return deployment;
  }
}

function assertIntegrationPrincipal(principal: Readonly<ApiClientPrincipal>): void {
  if (principal.type !== ApiClientType.INTEGRATION) {
    throw new DomainError({
      code: ErrorCode.FORBIDDEN,
      message: 'Integration API Client is required.',
    });
  }
}

function assertProjectSiteAccess(
  principal: Readonly<ApiClientPrincipal>,
  projectSiteIds: readonly string[],
): void {
  if (!projectSiteIds.some((siteId) => principal.siteIds.includes(siteId))) {
    throw new DomainError({
      code: ErrorCode.FORBIDDEN,
      message: 'API Client cannot access this Project Site scope.',
    });
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

function createDeploymentEvent(
  deploymentId: string,
  type: string,
  occurredAt: Date,
  input: {
    externalEventId?: string;
    status?: DeploymentStatusType;
    message?: string;
    metadata: Readonly<Record<string, unknown>>;
  },
): DeploymentEventRecord {
  return {
    id: createUuidV7(occurredAt.getTime()),
    deploymentId,
    externalEventId: input.externalEventId,
    type,
    status: input.status,
    message: input.message,
    metadata: input.metadata,
    occurredAt,
    createdAt: occurredAt,
  };
}

function hashRequest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`;
}

function projectNotFoundError(): DomainError {
  return new DomainError({
    code: ErrorCode.PROJECT_NOT_FOUND,
    message: 'Project was not found.',
  });
}

function deploymentNotFoundError(): DomainError {
  return new DomainError({
    code: ErrorCode.DEPLOYMENT_NOT_FOUND,
    message: 'Deployment was not found.',
  });
}

function idempotencyConflictError(): DomainError {
  return new DomainError({
    code: ErrorCode.IDEMPOTENCY_CONFLICT,
    message: 'Idempotency-Key was already used with a different request.',
    details: { field: 'Idempotency-Key' },
  });
}
