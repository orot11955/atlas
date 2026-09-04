import type { AuditService, Clock, TransactionRunner } from '../../../core';
import {
  ActorType,
  AuditResult,
  DomainError,
  ErrorCode,
  createUuidV7,
  isApplicationError,
  requestContext,
  systemClock,
} from '../../../core';
import {
  EventType,
  PUBLICATION_SCHEDULE_RETRY_DELAYS_MS,
  PublicationScheduleAction,
  PublicationScheduleStatus,
  assertContentSiteSchedulable,
  formatLocalDateTime,
  localDateTimeToUtc,
  normalizePublicationScheduleAction,
  normalizeScheduledFor,
  normalizeTimezone,
  retryAt,
  truncateOperationalMessage,
  type PublicationScheduleRecord,
} from '../domain/eventing';
import type { EventingRepositoryPort } from '../ports/eventing.repository';
import type { PublicationCommandPort } from '../ports/publication-command.port';
import type { OutboxService } from './outbox.service';

export interface CreatePublicationScheduleInput {
  action: string;
  scheduledLocalAt: string;
  timezone?: string;
}

export class PublicationSchedulingService<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: EventingRepositoryPort<TTransaction>,
    private readonly auditService: AuditService<TTransaction>,
    private readonly outboxService: OutboxService<TTransaction>,
    private readonly clock: Clock = systemClock,
  ) {}

  public async list(
    workspaceId: string,
    query: Readonly<{ contentId?: string; contentSiteId?: string; limit?: number }> = {},
  ): Promise<readonly Readonly<PublicationScheduleRecord>[]> {
    const records = await this.repository.listPublicationSchedules(workspaceId, {
      contentId: query.contentId,
      contentSiteId: query.contentSiteId,
      limit: normalizeLimit(query.limit),
    });

    return Object.freeze(records.map(freezeSchedule));
  }

  public async create(
    workspaceId: string,
    contentId: string,
    contentSiteId: string,
    input: Readonly<CreatePublicationScheduleInput>,
  ): Promise<Readonly<PublicationScheduleRecord>> {
    const actorId = requireAdminActorId();
    const createdAt = this.clock.now();
    const action = normalizePublicationScheduleAction(input.action);
    const id = createUuidV7(createdAt.getTime());

    try {
      return await this.transactionRunner.run(async (transaction) => {
        const target = await this.repository.findContentSiteScheduleTarget(
          workspaceId,
          contentId,
          contentSiteId,
          transaction,
        );

        if (!target) {
          throw new DomainError({
            code: ErrorCode.NOT_FOUND,
            message: 'Content Site assignment was not found.',
          });
        }

        assertContentSiteSchedulable(target, action);
        const timezone = normalizeTimezone(input.timezone ?? target.siteTimezone);
        const scheduledFor = normalizeScheduledFor(
          localDateTimeToUtc(input.scheduledLocalAt, timezone),
          createdAt,
        );
        const scheduledLocalAt = formatLocalDateTime(scheduledFor, timezone);
        const record: PublicationScheduleRecord = {
          id,
          workspaceId,
          siteId: target.siteId,
          contentId,
          contentSiteId,
          action,
          scheduledFor,
          timezone,
          scheduledLocalAt,
          status: PublicationScheduleStatus.PENDING,
          attemptCount: 0,
          nextAttemptAt: scheduledFor,
          version: 1,
          requestedByAdminAccountId: actorId,
          createdAt,
          updatedAt: createdAt,
        };

        await this.repository.insertPublicationSchedule(record, transaction);
        await this.outboxService.record(
          {
            workspaceId,
            siteId: target.siteId,
            aggregateType: 'publication-schedule',
            aggregateId: id,
            eventType: EventType.PUBLICATION_SCHEDULE_REQUESTED,
            data: {
              scheduleId: id,
              attemptNumber: 1,
              availableAt: scheduledFor.toISOString(),
            },
          },
          transaction,
        );
        await this.auditService.record(
          {
            action: 'content.publication-scheduled',
            targetType: 'publication-schedule',
            targetId: id,
            result: AuditResult.SUCCESS,
            metadata: {
              contentId,
              contentSiteId,
              siteId: target.siteId,
              action,
              scheduledFor: scheduledFor.toISOString(),
              scheduledLocalAt,
              timezone,
            },
          },
          transaction,
        );

        return freezeSchedule(record);
      });
    } catch (error) {
      throw mapScheduleConstraintError(error);
    }
  }

  public async cancel(
    workspaceId: string,
    scheduleId: string,
    version: number,
  ): Promise<Readonly<PublicationScheduleRecord>> {
    assertPositiveVersion(version);
    const cancelledAt = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findPublicationScheduleForUpdate(
        workspaceId,
        scheduleId,
        transaction,
      );

      if (!current) {
        throw scheduleNotFoundError();
      }

      if (current.status === PublicationScheduleStatus.CANCELLED) {
        return freezeSchedule(current);
      }

      if (current.status !== PublicationScheduleStatus.PENDING) {
        throw new DomainError({
          code: ErrorCode.INVALID_STATE_TRANSITION,
          message: 'Only pending Publication schedules can be cancelled.',
        });
      }

      const cancelled = await this.repository.cancelPublicationSchedule(
        workspaceId,
        scheduleId,
        version,
        cancelledAt,
        transaction,
      );

      if (!cancelled) {
        throw new DomainError({
          code: ErrorCode.VERSION_CONFLICT,
          message: 'Publication schedule was changed by another request.',
        });
      }

      await this.auditService.record(
        {
          action: 'content.publication-schedule-cancelled',
          targetType: 'publication-schedule',
          targetId: scheduleId,
          result: AuditResult.SUCCESS,
          metadata: {
            contentId: current.contentId,
            contentSiteId: current.contentSiteId,
            siteId: current.siteId,
            action: current.action,
          },
        },
        transaction,
      );

      return freezeSchedule({
        ...current,
        status: PublicationScheduleStatus.CANCELLED,
        cancelledAt,
        version: version + 1,
        updatedAt: cancelledAt,
      });
    });
  }

  public async retry(
    workspaceId: string,
    scheduleId: string,
    version: number,
  ): Promise<Readonly<PublicationScheduleRecord>> {
    assertPositiveVersion(version);
    const retriedAt = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findPublicationScheduleForUpdate(
        workspaceId,
        scheduleId,
        transaction,
      );

      if (!current) {
        throw scheduleNotFoundError();
      }
      if (current.status !== PublicationScheduleStatus.FAILED) {
        throw new DomainError({
          code: ErrorCode.INVALID_STATE_TRANSITION,
          message: 'Only failed Publication schedules can be retried.',
        });
      }

      const retried = await this.repository.retryPublicationSchedule(
        workspaceId,
        scheduleId,
        version,
        retriedAt,
        transaction,
      );
      if (!retried) {
        throw new DomainError({
          code: ErrorCode.VERSION_CONFLICT,
          message: 'Publication schedule was changed by another request.',
        });
      }

      const attemptNumber = current.attemptCount + 1;
      await this.outboxService.record(
        {
          workspaceId,
          siteId: current.siteId,
          aggregateType: 'publication-schedule',
          aggregateId: scheduleId,
          eventType: EventType.PUBLICATION_SCHEDULE_RETRY_REQUESTED,
          data: {
            scheduleId,
            attemptNumber,
            availableAt: retriedAt.toISOString(),
          },
        },
        transaction,
      );
      await this.auditService.record(
        {
          action: 'content.publication-schedule-retried',
          targetType: 'publication-schedule',
          targetId: scheduleId,
          result: AuditResult.SUCCESS,
          metadata: {
            contentId: current.contentId,
            contentSiteId: current.contentSiteId,
            siteId: current.siteId,
            action: current.action,
            attemptNumber,
          },
        },
        transaction,
      );

      return freezeSchedule({
        ...current,
        status: PublicationScheduleStatus.PENDING,
        nextAttemptAt: retriedAt,
        lastError: undefined,
        completedAt: undefined,
        version: version + 1,
        updatedAt: retriedAt,
      });
    });
  }
}

export class PublicationScheduleProcessor<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: EventingRepositoryPort<TTransaction>,
    private readonly command: PublicationCommandPort,
    private readonly auditService: AuditService<TTransaction>,
    private readonly clock: Clock = systemClock,
  ) {}

  public async process(scheduleId: string, attemptNumber: number): Promise<void> {
    const startedAt = this.clock.now();
    const schedule = await this.transactionRunner.run((transaction) =>
      this.repository.startPublicationScheduleAttempt(
        scheduleId,
        attemptNumber,
        startedAt,
        transaction,
      ),
    );

    if (!schedule) {
      return;
    }

    const parent = requestContext.get();
    const requestId = createUuidV7(startedAt.getTime());

    await requestContext.run(
      {
        requestId,
        traceId: parent?.traceId ?? requestId,
        correlationId: schedule.id,
        actorType: ActorType.ADMIN,
        actorId: schedule.requestedByAdminAccountId,
        workspaceId: schedule.workspaceId,
        siteId: schedule.siteId,
      },
      async () => {
        try {
          if (schedule.action === PublicationScheduleAction.PUBLISH) {
            await this.command.publish(
              schedule.workspaceId,
              schedule.contentId,
              schedule.contentSiteId,
            );
          } else {
            await this.command.withdraw(
              schedule.workspaceId,
              schedule.contentId,
              schedule.contentSiteId,
            );
          }

          const completedAt = this.clock.now();
          await this.transactionRunner.run(async (transaction) => {
            await this.repository.completePublicationSchedule(
              schedule.id,
              completedAt,
              transaction,
            );
            await this.auditService.record(
              {
                action: 'content.publication-schedule-completed',
                targetType: 'publication-schedule',
                targetId: schedule.id,
                result: AuditResult.SUCCESS,
                metadata: {
                  contentId: schedule.contentId,
                  contentSiteId: schedule.contentSiteId,
                  siteId: schedule.siteId,
                  action: schedule.action,
                  attemptNumber,
                },
              },
              transaction,
            );
          });
        } catch (error) {
          await this.handleFailure(schedule, attemptNumber, error);
          throw error;
        }
      },
    );
  }

  private async handleFailure(
    schedule: Readonly<PublicationScheduleRecord>,
    attemptNumber: number,
    error: unknown,
  ): Promise<void> {
    const failedAt = this.clock.now();
    const retry = isRetryableScheduleError(error)
      ? retryAt(failedAt, attemptNumber, PUBLICATION_SCHEDULE_RETRY_DELAYS_MS)
      : undefined;
    const terminal = retry === undefined;
    const errorMessage = truncateOperationalMessage(error);

    await this.transactionRunner.run(async (transaction) => {
      await this.repository.reschedulePublicationSchedule(
        schedule.id,
        retry ?? failedAt,
        errorMessage,
        terminal,
        failedAt,
        transaction,
      );

      await this.auditService.record(
        {
          action: terminal
            ? 'content.publication-schedule-failed'
            : 'content.publication-schedule-retry-scheduled',
          targetType: 'publication-schedule',
          targetId: schedule.id,
          result: AuditResult.FAILURE,
          errorCode: isApplicationError(error) ? error.code : ErrorCode.INTERNAL_ERROR,
          metadata: {
            contentId: schedule.contentId,
            contentSiteId: schedule.contentSiteId,
            siteId: schedule.siteId,
            action: schedule.action,
            attemptNumber,
            nextAttemptAt: retry?.toISOString(),
          },
        },
        transaction,
      );
    });
  }
}

function requireAdminActorId(): string {
  const context = requestContext.require();

  if (context.actorType !== ActorType.ADMIN || !context.actorId) {
    throw new DomainError({
      code: ErrorCode.AUTH_REQUIRED,
      message: 'An authenticated administrator is required.',
    });
  }

  return context.actorId;
}

function normalizeLimit(value?: number): number {
  if (value === undefined) {
    return 100;
  }

  if (!Number.isSafeInteger(value) || value < 1 || value > 200) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Publication schedule limit must be between 1 and 200.',
      details: { field: 'limit' },
    });
  }

  return value;
}

function assertPositiveVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Publication schedule version must be a positive safe integer.',
      details: { field: 'version' },
    });
  }
}

function freezeSchedule(record: PublicationScheduleRecord): Readonly<PublicationScheduleRecord> {
  return Object.freeze({
    ...record,
    scheduledFor: new Date(record.scheduledFor),
    nextAttemptAt: new Date(record.nextAttemptAt),
    completedAt: record.completedAt ? new Date(record.completedAt) : undefined,
    cancelledAt: record.cancelledAt ? new Date(record.cancelledAt) : undefined,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  });
}

function scheduleNotFoundError(): DomainError {
  return new DomainError({
    code: ErrorCode.NOT_FOUND,
    message: 'Publication schedule was not found.',
  });
}

function isRetryableScheduleError(error: unknown): boolean {
  if (!isApplicationError(error)) {
    return true;
  }

  const terminalCodes: readonly string[] = [
    ErrorCode.AUTH_REQUIRED,
    ErrorCode.FORBIDDEN,
    ErrorCode.INVALID_STATE_TRANSITION,
    ErrorCode.NOT_FOUND,
    ErrorCode.VALIDATION_FAILED,
  ];

  return !terminalCodes.includes(error.code);
}

function mapScheduleConstraintError(error: unknown): unknown {
  if (isPostgresError(error, '23505')) {
    return new DomainError({
      code: ErrorCode.VERSION_CONFLICT,
      message: 'An open Publication schedule already exists for this Content Site.',
      cause: error,
    });
  }

  return error;
}

function isPostgresError(error: unknown, code: string): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && String(error.code) === code,
  );
}
