import type { Clock } from '../clock';
import { systemClock } from '../clock';
import { DomainError, ErrorCode } from '../errors';
import { createUuidV7 } from '../ids';
import type { RequestContextStore } from '../request-context';
import { requestContext } from '../request-context';
import { redactAuditMetadata } from './audit-metadata';
import type { AuditRecord, RecordAuditInput } from './audit-record';
import type { AuditRepositoryPort } from './audit-repository.port';
import { AuditResult } from './audit-result';

const AUDIT_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export class AuditService<TTransaction = unknown> {
  public constructor(
    private readonly repository: AuditRepositoryPort<TTransaction>,
    private readonly clock: Clock = systemClock,
    private readonly contextStore: RequestContextStore = requestContext,
  ) {}

  public async record(
    input: RecordAuditInput,
    transaction?: TTransaction,
  ): Promise<Readonly<AuditRecord>> {
    validateAuditKey(input.action, 'action');
    validateAuditKey(input.targetType, 'targetType');

    const context = this.contextStore.require();
    const occurredAt = this.clock.now();
    const record: AuditRecord = {
      id: createUuidV7(occurredAt.getTime()),
      workspaceId: context.workspaceId,
      siteId: context.siteId,
      actorType: context.actorType,
      actorId: context.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      requestId: context.requestId,
      traceId: context.traceId,
      correlationId: context.correlationId,
      result: input.result ?? AuditResult.SUCCESS,
      errorCode: input.errorCode,
      metadata: redactAuditMetadata(input.metadata ?? {}),
      occurredAt,
    };

    await this.repository.insert(record, transaction);

    return Object.freeze(record);
  }
}

function validateAuditKey(value: string, field: string): void {
  if (!AUDIT_KEY_PATTERN.test(value) || value.length > 128) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: `Audit ${field} must be a lowercase dot, underscore or hyphen separated key.`,
      details: { field },
    });
  }
}
