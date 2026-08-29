import type { AuditService, Clock, TransactionRunner } from '../../../core';
import {
  AuditResult,
  DomainError,
  ErrorCode,
  requestContext,
  systemClock,
} from '../../../core';
import {
  normalizeWorkspaceLocale,
  normalizeWorkspaceName,
  normalizeWorkspaceTimezone,
  type UpdateWorkspaceDetails,
  type WorkspaceRecord,
} from '../domain/workspace';
import type { WorkspaceRepositoryPort } from '../ports/workspace.repository';

export interface UpdateWorkspaceInput extends UpdateWorkspaceDetails {
  version: number;
}

export class WorkspaceService<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: WorkspaceRepositoryPort<TTransaction>,
    private readonly auditService: AuditService<TTransaction>,
    private readonly clock: Clock = systemClock,
  ) {}

  public async getDefaultWorkspace(): Promise<Readonly<WorkspaceRecord>> {
    const workspace = await this.repository.findDefault();

    if (!workspace) {
      throw new DomainError({
        code: ErrorCode.WORKSPACE_NOT_FOUND,
        message: 'The default Workspace is not available.',
      });
    }

    return Object.freeze(workspace);
  }

  public async updateWorkspace(
    workspaceId: string,
    input: UpdateWorkspaceInput,
  ): Promise<Readonly<WorkspaceRecord>> {
    assertPositiveVersion(input.version);
    const name = normalizeWorkspaceName(input.name);
    const timezone = normalizeWorkspaceTimezone(input.timezone);
    const locale = normalizeWorkspaceLocale(input.locale);
    const updatedAt = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findById(workspaceId, transaction);

      if (!current) {
        throw new DomainError({
          code: ErrorCode.WORKSPACE_NOT_FOUND,
          message: 'Workspace was not found.',
        });
      }

      const updated = await this.repository.update(
        workspaceId,
        {
          name,
          timezone,
          locale,
          expectedVersion: input.version,
          nextVersion: input.version + 1,
          updatedAt,
        },
        transaction,
      );

      if (!updated) {
        throw new DomainError({
          code: ErrorCode.VERSION_CONFLICT,
          message: 'Workspace was changed by another request.',
        });
      }

      await this.auditService.record(
        {
          action: 'workspace.updated',
          targetType: 'workspace',
          targetId: workspaceId,
          result: AuditResult.SUCCESS,
          metadata: {
            changedFields: ['name', 'timezone', 'locale'],
            version: input.version + 1,
          },
        },
        transaction,
      );

      return Object.freeze({
        ...current,
        name,
        timezone,
        locale,
        version: input.version + 1,
        updatedAt,
      });
    });
  }

  public enterRequestContext(workspaceId: string): void {
    const current = requestContext.require();
    requestContext.enter({ ...current, workspaceId });
  }
}

function assertPositiveVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Workspace version is invalid.',
      details: { field: 'version' },
    });
  }
}
