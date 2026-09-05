from __future__ import annotations

from pathlib import Path
from textwrap import dedent


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


def replace_once(path: str, old: str, new: str, label: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match in {path}, found {count}")
    write(path, content.replace(old, new, 1))


def replace_count(path: str, old: str, new: str, expected: int, label: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} matches in {path}, found {count}")
    write(path, content.replace(old, new))


def replace_section(path: str, start_marker: str, end_marker: str, replacement: str, label: str) -> None:
    content = read(path)
    start = content.find(start_marker)
    if start < 0:
        raise SystemExit(f"{label}: start marker missing in {path}")
    end = content.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"{label}: end marker missing in {path}")
    write(path, content[:start] + replacement + content[end:])


# ---------------------------------------------------------------------------
# Domain and persistence schema
# ---------------------------------------------------------------------------
replace_once(
    "packages/server/src/modules/eventing/domain/eventing.ts",
    "  PUBLICATION_SCHEDULE_REQUESTED: 'publication.schedule.requested',\n  PUBLICATION_SCHEDULE_RETRY_REQUESTED: 'publication.schedule.retry-requested',",
    "  PUBLICATION_SCHEDULE_EFFECT_APPLIED: 'publication.schedule.effect-applied',\n  PUBLICATION_SCHEDULE_REQUESTED: 'publication.schedule.requested',\n  PUBLICATION_SCHEDULE_RETRY_REQUESTED: 'publication.schedule.retry-requested',",
    "event type marker",
)
replace_once(
    "packages/server/src/modules/eventing/domain/eventing.ts",
    "  revisionId?: string;\n  revisionNumber?: number;\n  action: PublicationScheduleAction;",
    "  revisionId?: string;\n  revisionNumber?: number;\n  targetPublicationId?: string;\n  action: PublicationScheduleAction;",
    "schedule target domain field",
)
replace_once(
    "packages/server/src/modules/eventing/infrastructure/persistence/eventing.entities.ts",
    "  @Column({ name: 'revision_number', type: 'integer', nullable: true })\n  public revisionNumber!: number | null;\n\n  @Column({ type: 'varchar', length: 16 })",
    "  @Column({ name: 'revision_number', type: 'integer', nullable: true })\n  public revisionNumber!: number | null;\n\n  @Column({ name: 'target_publication_id', type: 'uuid', nullable: true })\n  public targetPublicationId!: string | null;\n\n  @Column({ type: 'varchar', length: 16 })",
    "schedule target entity field",
)
replace_once(
    "apps/admin-web/src/features/eventing/eventing-types.ts",
    "  contentSiteId: string;\n  action: PublicationScheduleAction;",
    "  contentSiteId: string;\n  revisionId?: string;\n  revisionNumber?: number;\n  targetPublicationId?: string;\n  action: PublicationScheduleAction;",
    "schedule target web type",
)

port_path = "packages/server/src/modules/eventing/ports/eventing.repository.ts"
replace_once(
    port_path,
    "  revisionId?: string;\n  revisionNumber?: number;\n  action: PublicationScheduleAction;",
    "  revisionId?: string;\n  revisionNumber?: number;\n  targetPublicationId?: string;\n  action: PublicationScheduleAction;",
    "schedule target repository input",
)
replace_once(
    port_path,
    "  findOutboxEvent(\n    eventId: string,\n    transaction?: TTransaction,\n  ): Promise<OutboxEventRecord | undefined>;\n  claimAvailableOutboxEvents(",
    "  findOutboxEvent(\n    eventId: string,\n    transaction?: TTransaction,\n  ): Promise<OutboxEventRecord | undefined>;\n  hasPublicationScheduleEffect(\n    workspaceId: string,\n    scheduleId: string,\n    transaction?: TTransaction,\n  ): Promise<boolean>;\n  claimAvailableOutboxEvents(",
    "schedule effect repository contract",
)

base_repo_path = (
    "packages/server/src/modules/eventing/infrastructure/persistence/"
    "typeorm-eventing.repository.ts"
)
replace_once(
    base_repo_path,
    "  revision_id: string | null;\n  revision_number: number | string | null;\n  action: 'publish' | 'withdraw';",
    "  revision_id: string | null;\n  revision_number: number | string | null;\n  target_publication_id: string | null;\n  action: 'publish' | 'withdraw';",
    "schedule target row field",
)
replace_once(
    base_repo_path,
    "export class TypeOrmEventingRepository implements EventingRepositoryPort<EntityManager> {\n  public constructor(private readonly dataSource: DataSource) {}\n\n  public async insertOutboxEvent(",
    dedent(
        """
        export class TypeOrmEventingRepository implements EventingRepositoryPort<EntityManager> {
          public constructor(private readonly dataSource: DataSource) {}

          public async hasPublicationScheduleEffect(
            workspaceId: string,
            scheduleId: string,
            transaction?: EntityManager,
          ): Promise<boolean> {
            const rows = await (transaction ?? this.dataSource.manager).query<
              { exists: boolean | string | number }[]
            >(
              `
                SELECT EXISTS (
                  SELECT 1
                  FROM "outbox_events"
                  WHERE "workspace_id" = $1
                    AND "aggregate_type" = 'publication-schedule'
                    AND "aggregate_id" = $2
                    AND "event_type" = 'publication.schedule.effect-applied'
                ) AS "exists"
              `,
              [workspaceId, scheduleId],
            );
            const value = rows[0]?.exists;
            return value === true || value === 'true' || value === 1 || value === '1';
          }

          public async insertOutboxEvent(
        """
    ).rstrip(),
    "schedule effect query",
)

write(
    "packages/server/src/modules/eventing/infrastructure/persistence/"
    "snapshot-typeorm-eventing.repository.ts",
    dedent(
        r"""
        import type { DataSource, EntityManager } from 'typeorm';

        import {
          PublicationScheduleStatus,
          type PublicationScheduleRecord,
        } from '../../domain/eventing';
        import type { CreatePublicationScheduleRecordInput } from '../../ports/eventing.repository';
        import { PublicationScheduleEntity } from './eventing.entities';
        import { SubscriptionAwareTypeOrmEventingRepository } from './subscription-aware-typeorm-eventing.repository';

        interface PublicationScheduleRow {
          id: string;
          workspace_id: string;
          site_id: string;
          site_key?: string;
          site_name?: string;
          content_id: string;
          content_title?: string;
          content_site_id: string;
          revision_id: string | null;
          revision_number: number | string | null;
          target_publication_id: string | null;
          action: PublicationScheduleRecord['action'];
          scheduled_for: Date | string;
          timezone: string;
          scheduled_local_at: string;
          status: PublicationScheduleStatus;
          attempt_count: number | string;
          next_attempt_at: Date | string;
          last_error: string | null;
          completed_at: Date | string | null;
          cancelled_at: Date | string | null;
          version: number | string;
          requested_by_admin_account_id: string;
          created_at: Date | string;
          updated_at: Date | string;
        }

        export class SnapshotTypeOrmEventingRepository extends SubscriptionAwareTypeOrmEventingRepository {
          public constructor(private readonly scheduleDataSource: DataSource) {
            super(scheduleDataSource);
          }

          public override async insertPublicationSchedule(
            input: CreatePublicationScheduleRecordInput,
            transaction: EntityManager,
          ): Promise<void> {
            await transaction.getRepository(PublicationScheduleEntity).insert({
              id: input.id,
              workspaceId: input.workspaceId,
              siteId: input.siteId,
              contentId: input.contentId,
              contentSiteId: input.contentSiteId,
              revisionId: input.revisionId ?? null,
              revisionNumber: input.revisionNumber ?? null,
              targetPublicationId: input.targetPublicationId ?? null,
              action: input.action,
              scheduledFor: input.scheduledFor,
              timezone: input.timezone,
              scheduledLocalAt: input.scheduledLocalAt,
              status: PublicationScheduleStatus.PENDING,
              attemptCount: 0,
              nextAttemptAt: input.scheduledFor,
              lastError: null,
              completedAt: null,
              cancelledAt: null,
              version: 1,
              requestedByAdminAccountId: input.requestedByAdminAccountId,
              createdAt: input.createdAt,
              updatedAt: input.createdAt,
            });
          }

          public override async listPublicationSchedules(
            workspaceId: string,
            query: Readonly<{ contentId?: string; contentSiteId?: string; limit: number }>,
          ): Promise<readonly PublicationScheduleRecord[]> {
            const parameters: unknown[] = [workspaceId, query.limit];
            const filters: string[] = [];

            if (query.contentId) {
              parameters.push(query.contentId);
              filters.push(`schedule."content_id" = $${parameters.length}`);
            }
            if (query.contentSiteId) {
              parameters.push(query.contentSiteId);
              filters.push(`schedule."content_site_id" = $${parameters.length}`);
            }

            const whereExtra = filters.length ? `AND ${filters.join(' AND ')}` : '';
            const rows = await this.scheduleDataSource.query<PublicationScheduleRow[]>(
              `
                SELECT
                  schedule.*,
                  site."key" AS site_key,
                  site."name" AS site_name,
                  draft."title" AS content_title
                FROM "publication_schedules" schedule
                INNER JOIN "sites" site
                  ON site."id" = schedule."site_id"
                  AND site."workspace_id" = schedule."workspace_id"
                INNER JOIN "content_drafts" draft
                  ON draft."content_id" = schedule."content_id"
                  AND draft."workspace_id" = schedule."workspace_id"
                WHERE schedule."workspace_id" = $1
                ${whereExtra}
                ORDER BY schedule."created_at" DESC, schedule."id" DESC
                LIMIT $2
              `,
              parameters,
            );

            return rows.map(toPublicationScheduleRecord);
          }

          public override async listDuePublicationSchedules(
            now: Date,
            limit: number,
          ): Promise<readonly PublicationScheduleRecord[]> {
            const rows = await this.scheduleDataSource.query<PublicationScheduleRow[]>(
              `
                SELECT schedule.*
                FROM "publication_schedules" schedule
                WHERE schedule."status" = 'pending'
                  AND schedule."next_attempt_at" <= $1
                ORDER BY schedule."next_attempt_at" ASC, schedule."id" ASC
                LIMIT $2
              `,
              [now, limit],
            );

            return rows.map(toPublicationScheduleRecord);
          }

          public override async findPublicationScheduleForUpdate(
            workspaceId: string,
            scheduleId: string,
            transaction: EntityManager,
          ): Promise<PublicationScheduleRecord | undefined> {
            const entity = await transaction
              .getRepository(PublicationScheduleEntity)
              .createQueryBuilder('schedule')
              .setLock('pessimistic_write')
              .where('schedule.id = :scheduleId', { scheduleId })
              .andWhere('schedule.workspace_id = :workspaceId', { workspaceId })
              .getOne();

            return entity ? toPublicationScheduleRecordFromEntity(entity) : undefined;
          }

          public override async startPublicationScheduleAttempt(
            scheduleId: string,
            attemptNumber: number,
            startedAt: Date,
            transaction: EntityManager,
          ): Promise<PublicationScheduleRecord | undefined> {
            const entity = await transaction
              .getRepository(PublicationScheduleEntity)
              .createQueryBuilder('schedule')
              .setLock('pessimistic_write')
              .where('schedule.id = :scheduleId', { scheduleId })
              .getOne();

            if (
              !entity ||
              entity.status !== PublicationScheduleStatus.PENDING ||
              entity.nextAttemptAt.getTime() > startedAt.getTime() ||
              attemptNumber !== entity.attemptCount + 1
            ) {
              return undefined;
            }

            entity.status = PublicationScheduleStatus.PROCESSING;
            entity.attemptCount = attemptNumber;
            entity.version += 1;
            entity.updatedAt = startedAt;
            await transaction.getRepository(PublicationScheduleEntity).save(entity);

            return toPublicationScheduleRecordFromEntity(entity);
          }
        }

        function toPublicationScheduleRecord(row: PublicationScheduleRow): PublicationScheduleRecord {
          return {
            id: row.id,
            workspaceId: row.workspace_id,
            siteId: row.site_id,
            siteKey: row.site_key,
            siteName: row.site_name,
            contentId: row.content_id,
            contentTitle: row.content_title,
            contentSiteId: row.content_site_id,
            revisionId: row.revision_id ?? undefined,
            revisionNumber:
              row.revision_number === null ? undefined : Number(row.revision_number),
            targetPublicationId: row.target_publication_id ?? undefined,
            action: row.action,
            scheduledFor: new Date(row.scheduled_for),
            timezone: row.timezone,
            scheduledLocalAt: row.scheduled_local_at,
            status: row.status,
            attemptCount: Number(row.attempt_count),
            nextAttemptAt: new Date(row.next_attempt_at),
            lastError: row.last_error ?? undefined,
            completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
            cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : undefined,
            version: Number(row.version),
            requestedByAdminAccountId: row.requested_by_admin_account_id,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
          };
        }

        function toPublicationScheduleRecordFromEntity(
          entity: PublicationScheduleEntity,
        ): PublicationScheduleRecord {
          return {
            id: entity.id,
            workspaceId: entity.workspaceId,
            siteId: entity.siteId,
            contentId: entity.contentId,
            contentSiteId: entity.contentSiteId,
            revisionId: entity.revisionId ?? undefined,
            revisionNumber: entity.revisionNumber ?? undefined,
            targetPublicationId: entity.targetPublicationId ?? undefined,
            action: entity.action,
            scheduledFor: new Date(entity.scheduledFor),
            timezone: entity.timezone,
            scheduledLocalAt: entity.scheduledLocalAt,
            status: entity.status,
            attemptCount: entity.attemptCount,
            nextAttemptAt: new Date(entity.nextAttemptAt),
            lastError: entity.lastError ?? undefined,
            completedAt: entity.completedAt ? new Date(entity.completedAt) : undefined,
            cancelledAt: entity.cancelledAt ? new Date(entity.cancelledAt) : undefined,
            version: entity.version,
            requestedByAdminAccountId: entity.requestedByAdminAccountId,
            createdAt: new Date(entity.createdAt),
            updatedAt: new Date(entity.updatedAt),
          };
        }
        """
    ),
)

write(
    "packages/server/src/modules/eventing/index.ts",
    dedent(
        """
        export * from './application/outbox-relay.service';
        export * from './application/outbox.service';
        export * from './application/publication-scheduling.service';
        export * from './application/webhook-administration.service';
        export * from './application/webhook-delivery.service';
        export * from './domain/eventing';
        export * from './infrastructure/crypto/aes256-gcm-webhook-secret-cipher';
        export * from './infrastructure/crypto/node-webhook-secret-generator';
        export * from './infrastructure/http/node-webhook-sender';
        export * from './infrastructure/persistence/eventing.entities';
        export {
          SafeTypeOrmEventingRepository,
          unwrapTypeOrmMutationRows,
        } from './infrastructure/persistence/safe-typeorm-eventing.repository';
        export { SnapshotTypeOrmEventingRepository } from './infrastructure/persistence/snapshot-typeorm-eventing.repository';
        export {
          SubscriptionAwareTypeOrmEventingRepository,
        } from './infrastructure/persistence/subscription-aware-typeorm-eventing.repository';
        export {
          SnapshotTypeOrmEventingRepository as TypeOrmEventingRepository,
        } from './infrastructure/persistence/snapshot-typeorm-eventing.repository';
        export { TypeOrmEventingRepository as BaseTypeOrmEventingRepository } from './infrastructure/persistence/typeorm-eventing.repository';
        export * from './ports/eventing-queue.port';
        export * from './ports/eventing.repository';
        export * from './ports/outbox-recorder.port';
        export * from './ports/publication-command.port';
        export * from './ports/webhook-secret-cipher.port';
        export * from './ports/webhook-secret-generator.port';
        export * from './ports/webhook-sender.port';
        """
    ),
)

write(
    "packages/database/src/migrations/1788130900000-AlignPublicationScheduleRevisionTarget.ts",
    dedent(
        r"""
        import type { MigrationInterface, QueryRunner } from 'typeorm';

        export class AlignPublicationScheduleRevisionTarget1788130900000
          implements MigrationInterface
        {
          public readonly name = 'AlignPublicationScheduleRevisionTarget1788130900000';

          public async up(queryRunner: QueryRunner): Promise<void> {
            await queryRunner.query(`
              ALTER TABLE "publication_schedules"
              ADD COLUMN "revision_id" uuid,
              ADD COLUMN "revision_number" integer,
              ADD COLUMN "target_publication_id" uuid
            `);
            await queryRunner.query(`
              ALTER TABLE "publication_schedules"
              ADD CONSTRAINT "fk_publication_schedules_revision_workspace"
              FOREIGN KEY ("revision_id", "workspace_id")
              REFERENCES "content_revisions" ("id", "workspace_id") ON DELETE RESTRICT
            `);
            await queryRunner.query(`
              ALTER TABLE "publication_schedules"
              ADD CONSTRAINT "fk_publication_schedules_target_publication_workspace"
              FOREIGN KEY ("target_publication_id", "workspace_id")
              REFERENCES "content_publications" ("id", "workspace_id") ON DELETE RESTRICT
            `);
            await queryRunner.query(`
              ALTER TABLE "publication_schedules"
              ADD CONSTRAINT "chk_publication_schedules_target"
              CHECK (
                (
                  "action" = 'publish'
                  AND "revision_id" IS NOT NULL
                  AND "revision_number" >= 1
                  AND "target_publication_id" IS NULL
                )
                OR (
                  "action" = 'withdraw'
                  AND "revision_id" IS NULL
                  AND "revision_number" IS NULL
                  AND "target_publication_id" IS NOT NULL
                )
              )
            `);
            await queryRunner.query(`
              CREATE UNIQUE INDEX "uq_outbox_publication_schedule_effect"
              ON "outbox_events" ("workspace_id", "aggregate_id", "event_type")
              WHERE "aggregate_type" = 'publication-schedule'
                AND "event_type" = 'publication.schedule.effect-applied'
            `);
            await queryRunner.query(`
              CREATE OR REPLACE FUNCTION "atlas_guard_publication_schedule_immutable"()
              RETURNS trigger AS $$
              BEGIN
                IF TG_OP = 'DELETE' THEN
                  RAISE EXCEPTION 'Publication Schedules cannot be deleted';
                END IF;

                IF NEW."id" IS DISTINCT FROM OLD."id"
                  OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
                  OR NEW."site_id" IS DISTINCT FROM OLD."site_id"
                  OR NEW."content_id" IS DISTINCT FROM OLD."content_id"
                  OR NEW."content_site_id" IS DISTINCT FROM OLD."content_site_id"
                  OR NEW."revision_id" IS DISTINCT FROM OLD."revision_id"
                  OR NEW."revision_number" IS DISTINCT FROM OLD."revision_number"
                  OR NEW."target_publication_id" IS DISTINCT FROM OLD."target_publication_id"
                  OR NEW."action" IS DISTINCT FROM OLD."action"
                  OR NEW."scheduled_for" IS DISTINCT FROM OLD."scheduled_for"
                  OR NEW."timezone" IS DISTINCT FROM OLD."timezone"
                  OR NEW."scheduled_local_at" IS DISTINCT FROM OLD."scheduled_local_at"
                  OR NEW."requested_by_admin_account_id" IS DISTINCT FROM OLD."requested_by_admin_account_id"
                  OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
                  RAISE EXCEPTION 'Publication Schedule definition is immutable';
                END IF;

                RETURN NEW;
              END;
              $$ LANGUAGE plpgsql
            `);
          }

          public async down(queryRunner: QueryRunner): Promise<void> {
            await queryRunner.query('DROP INDEX "uq_outbox_publication_schedule_effect"');
            await queryRunner.query(`
              CREATE OR REPLACE FUNCTION "atlas_guard_publication_schedule_immutable"()
              RETURNS trigger AS $$
              BEGIN
                IF TG_OP = 'DELETE' THEN
                  RAISE EXCEPTION 'Publication Schedules cannot be deleted';
                END IF;

                IF NEW."id" IS DISTINCT FROM OLD."id"
                  OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
                  OR NEW."site_id" IS DISTINCT FROM OLD."site_id"
                  OR NEW."content_id" IS DISTINCT FROM OLD."content_id"
                  OR NEW."content_site_id" IS DISTINCT FROM OLD."content_site_id"
                  OR NEW."action" IS DISTINCT FROM OLD."action"
                  OR NEW."scheduled_for" IS DISTINCT FROM OLD."scheduled_for"
                  OR NEW."timezone" IS DISTINCT FROM OLD."timezone"
                  OR NEW."scheduled_local_at" IS DISTINCT FROM OLD."scheduled_local_at"
                  OR NEW."requested_by_admin_account_id" IS DISTINCT FROM OLD."requested_by_admin_account_id"
                  OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
                  RAISE EXCEPTION 'Publication Schedule definition is immutable';
                END IF;

                RETURN NEW;
              END;
              $$ LANGUAGE plpgsql
            `);
            await queryRunner.query(`
              ALTER TABLE "publication_schedules"
              DROP CONSTRAINT "chk_publication_schedules_target"
            `);
            await queryRunner.query(`
              ALTER TABLE "publication_schedules"
              DROP CONSTRAINT "fk_publication_schedules_target_publication_workspace"
            `);
            await queryRunner.query(`
              ALTER TABLE "publication_schedules"
              DROP CONSTRAINT "fk_publication_schedules_revision_workspace"
            `);
            await queryRunner.query(`
              ALTER TABLE "publication_schedules"
              DROP COLUMN "target_publication_id",
              DROP COLUMN "revision_number",
              DROP COLUMN "revision_id"
            `);
          }
        }
        """
    ),
)

# ---------------------------------------------------------------------------
# Scheduling application service and command contract
# ---------------------------------------------------------------------------
write(
    "packages/server/src/modules/eventing/ports/publication-command.port.ts",
    dedent(
        """
        export interface PublicationCommandPort {
          publishScheduledRevision(
            workspaceId: string,
            contentId: string,
            contentSiteId: string,
            revisionId: string,
            scheduleId: string,
          ): Promise<Readonly<{ replayed: boolean }>>;
          withdrawScheduledPublication(
            workspaceId: string,
            contentId: string,
            contentSiteId: string,
            publicationId: string,
            scheduleId: string,
          ): Promise<Readonly<{ replayed: boolean }>>;
        }
        """
    ),
)

schedule_service = "packages/server/src/modules/eventing/application/publication-scheduling.service.ts"
replace_once(
    schedule_service,
    "        const scheduledLocalAt = formatLocalDateTime(scheduledFor, timezone);\n        const record: PublicationScheduleRecord = {",
    dedent(
        """
                const scheduledLocalAt = formatLocalDateTime(scheduledFor, timezone);
                const revisionId =
                  action === PublicationScheduleAction.PUBLISH ? target.readyRevisionId : undefined;
                const revisionNumber =
                  action === PublicationScheduleAction.PUBLISH ? target.readyRevisionNumber : undefined;
                const targetPublicationId =
                  action === PublicationScheduleAction.WITHDRAW
                    ? target.activePublicationId
                    : undefined;

                if (
                  action === PublicationScheduleAction.PUBLISH &&
                  (!revisionId || revisionNumber === undefined)
                ) {
                  throw new DomainError({
                    code: ErrorCode.INVALID_STATE_TRANSITION,
                    message: 'A concrete READY Revision is required for scheduled publication.',
                  });
                }
                if (action === PublicationScheduleAction.WITHDRAW && !targetPublicationId) {
                  throw new DomainError({
                    code: ErrorCode.INVALID_STATE_TRANSITION,
                    message: 'A concrete active Publication is required for scheduled withdrawal.',
                  });
                }

                const record: PublicationScheduleRecord = {
        """
    ).rstrip(),
    "capture schedule targets",
)
replace_once(
    schedule_service,
    "          contentId,\n          contentSiteId,\n          action,",
    "          contentId,\n          contentSiteId,\n          revisionId,\n          revisionNumber,\n          targetPublicationId,\n          action,",
    "persist schedule targets",
)
replace_once(
    schedule_service,
    "              scheduleId: id,\n              attemptNumber: 1,\n              availableAt: scheduledFor.toISOString(),",
    "              scheduleId: id,\n              attemptNumber: 1,\n              availableAt: scheduledFor.toISOString(),\n              revisionId: revisionId ?? null,\n              revisionNumber: revisionNumber ?? null,\n              targetPublicationId: targetPublicationId ?? null,",
    "schedule requested event target data",
)
replace_once(
    schedule_service,
    "              action,\n              scheduledFor: scheduledFor.toISOString(),",
    "              action,\n              revisionId,\n              revisionNumber,\n              targetPublicationId,\n              scheduledFor: scheduledFor.toISOString(),",
    "schedule audit target data",
)
replace_once(
    schedule_service,
    dedent(
        """
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
        """
    ).rstrip(),
    dedent(
        """
                  try {
                    const recoveredEffect = await this.repository.hasPublicationScheduleEffect(
                      schedule.workspaceId,
                      schedule.id,
                    );

                    if (!recoveredEffect) {
                      if (schedule.action === PublicationScheduleAction.PUBLISH) {
                        if (!schedule.revisionId) {
                          throw new DomainError({
                            code: ErrorCode.INVALID_STATE_TRANSITION,
                            message: 'Scheduled publication is missing its READY Revision target.',
                          });
                        }
                        await this.command.publishScheduledRevision(
                          schedule.workspaceId,
                          schedule.contentId,
                          schedule.contentSiteId,
                          schedule.revisionId,
                          schedule.id,
                        );
                      } else {
                        if (!schedule.targetPublicationId) {
                          throw new DomainError({
                            code: ErrorCode.INVALID_STATE_TRANSITION,
                            message: 'Scheduled withdrawal is missing its Publication target.',
                          });
                        }
                        await this.command.withdrawScheduledPublication(
                          schedule.workspaceId,
                          schedule.contentId,
                          schedule.contentSiteId,
                          schedule.targetPublicationId,
                          schedule.id,
                        );
                      }
                    }

                    const completedAt = this.clock.now();
        """
    ).rstrip(),
    "execute immutable schedule target",
)
replace_once(
    schedule_service,
    "                  action: schedule.action,\n                  attemptNumber,",
    "                  action: schedule.action,\n                  revisionId: schedule.revisionId,\n                  targetPublicationId: schedule.targetPublicationId,\n                  recoveredEffect,\n                  attemptNumber,",
    "schedule completion audit target",
)

# ---------------------------------------------------------------------------
# Content Publication scheduled commands and atomic effect marker
# ---------------------------------------------------------------------------
content_service = "packages/server/src/modules/content/application/content-publication.service.ts"
replace_section(
    content_service,
    "  public publishRevision(",
    "\n  private async publishWithRevision(",
    dedent(
        """
          public publishRevision(
            workspaceId: string,
            contentId: string,
            contentSiteId: string,
            revisionId: string,
          ): Promise<Readonly<ContentPublicationMutationResult>> {
            if (!isUuidV7(revisionId)) {
              throw new DomainError({
                code: ErrorCode.VALIDATION_FAILED,
                message: 'Scheduled Publication revision ID must be a UUIDv7.',
                details: { field: 'revisionId' },
              });
            }

            return this.publishWithRevision(workspaceId, contentId, contentSiteId, revisionId);
          }

          public publishScheduledRevision(
            workspaceId: string,
            contentId: string,
            contentSiteId: string,
            revisionId: string,
            scheduleId: string,
          ): Promise<Readonly<ContentPublicationMutationResult>> {
            if (!isUuidV7(revisionId) || !isUuidV7(scheduleId)) {
              throw new DomainError({
                code: ErrorCode.VALIDATION_FAILED,
                message: 'Scheduled Publication identifiers must be UUIDv7 values.',
                details: { field: !isUuidV7(revisionId) ? 'revisionId' : 'scheduleId' },
              });
            }

            return this.publishWithRevision(
              workspaceId,
              contentId,
              contentSiteId,
              revisionId,
              scheduleId,
            );
          }
        """
    ).rstrip(),
    "scheduled publish command",
)
replace_once(
    content_service,
    "    contentSiteId: string,\n    revisionId?: string,\n  ): Promise<Readonly<ContentPublicationMutationResult>> {",
    "    contentSiteId: string,\n    revisionId?: string,\n    scheduleId?: string,\n  ): Promise<Readonly<ContentPublicationMutationResult>> {",
    "publish schedule id parameter",
)
replace_once(
    content_service,
    "        if (active?.etag === etag) {\n          return Object.freeze({ publication: freezePublication(active), replayed: true });\n        }",
    dedent(
        """
                if (active?.etag === etag) {
                  if (scheduleId) {
                    await this.recordPublicationScheduleEffect(
                      {
                        scheduleId,
                        action: 'publish',
                        publication: active,
                        replayed: true,
                      },
                      transaction,
                    );
                  }
                  return Object.freeze({ publication: freezePublication(active), replayed: true });
                }
        """
    ).rstrip(),
    "publish replay effect marker",
)
replace_count(
    content_service,
    "              scheduled: revisionId !== undefined,",
    "              scheduled: scheduleId !== undefined,\n              scheduleId,",
    2,
    "publish scheduled metadata",
)
replace_once(
    content_service,
    "        return Object.freeze({ publication: freezePublication(publication), replayed: false });",
    dedent(
        """
                if (scheduleId) {
                  await this.recordPublicationScheduleEffect(
                    {
                      scheduleId,
                      action: 'publish',
                      publication,
                      replayed: false,
                    },
                    transaction,
                  );
                }

                return Object.freeze({ publication: freezePublication(publication), replayed: false });
        """
    ).rstrip(),
    "publish applied effect marker",
)

replace_section(
    content_service,
    "  public async withdraw(",
    "\n  public async listPublications(",
    dedent(
        """
          public async withdraw(
            workspaceId: string,
            contentId: string,
            contentSiteId: string,
          ): Promise<Readonly<ContentPublicationRecord>> {
            const result = await this.withdrawExpected(workspaceId, contentId, contentSiteId);
            return result.publication;
          }

          public withdrawScheduledPublication(
            workspaceId: string,
            contentId: string,
            contentSiteId: string,
            publicationId: string,
            scheduleId: string,
          ): Promise<Readonly<ContentPublicationMutationResult>> {
            if (!isUuidV7(publicationId) || !isUuidV7(scheduleId)) {
              throw new DomainError({
                code: ErrorCode.VALIDATION_FAILED,
                message: 'Scheduled withdrawal identifiers must be UUIDv7 values.',
                details: { field: !isUuidV7(publicationId) ? 'publicationId' : 'scheduleId' },
              });
            }

            return this.withdrawExpected(
              workspaceId,
              contentId,
              contentSiteId,
              publicationId,
              scheduleId,
            );
          }

          private async withdrawExpected(
            workspaceId: string,
            contentId: string,
            contentSiteId: string,
            targetPublicationId?: string,
            scheduleId?: string,
          ): Promise<Readonly<ContentPublicationMutationResult>> {
            const withdrawnAt = this.clock.now();

            return this.transactionRunner.run(async (transaction) => {
              const contentSite = await this.repository.findContentSiteForUpdate(
                workspaceId,
                contentId,
                contentSiteId,
                transaction,
              );

              if (!contentSite) {
                throw contentSiteNotFoundError();
              }

              const target = targetPublicationId
                ? await this.repository.findPublication(
                    workspaceId,
                    contentSiteId,
                    targetPublicationId,
                    transaction,
                  )
                : undefined;

              if (targetPublicationId && !target) {
                throw publicationNotFoundError();
              }

              if (target && target.status !== ContentPublicationStatus.ACTIVE) {
                if (scheduleId) {
                  await this.recordPublicationScheduleEffect(
                    {
                      scheduleId,
                      action: 'withdraw',
                      publication: target,
                      replayed: true,
                    },
                    transaction,
                  );
                }
                return Object.freeze({ publication: freezePublication(target), replayed: true });
              }

              const active =
                target ??
                (await this.repository.findActivePublication(
                  workspaceId,
                  contentSiteId,
                  transaction,
                ));

              if (!active) {
                throw new DomainError({
                  code: ErrorCode.INVALID_STATE_TRANSITION,
                  message: 'Content Site does not have an active Publication to withdraw.',
                });
              }

              if (targetPublicationId && active.id !== targetPublicationId) {
                throw versionConflictError(
                  'The scheduled Publication target is no longer the active Publication.',
                );
              }

              const withdrawn = await this.repository.withdrawActivePublication(
                workspaceId,
                contentSiteId,
                withdrawnAt,
                transaction,
              );

              if (!withdrawn) {
                throw versionConflictError('Active Publication was changed by another request.');
              }

              const withdrawnPublication = {
                ...active,
                status: ContentPublicationStatus.WITHDRAWN,
                withdrawnAt,
              } as const;

              await this.auditService.record(
                {
                  action: 'content.publication-withdrawn',
                  targetType: 'content-publication',
                  targetId: active.id,
                  result: AuditResult.SUCCESS,
                  metadata: {
                    contentId,
                    contentSiteId,
                    siteId: contentSite.siteId,
                    revisionId: active.revisionId,
                    revisionNumber: active.revisionNumber,
                    scheduled: scheduleId !== undefined,
                    scheduleId,
                  },
                },
                transaction,
              );
              await this.outboxService?.record(
                {
                  workspaceId,
                  siteId: contentSite.siteId,
                  aggregateType: 'content-publication',
                  aggregateId: active.id,
                  eventType: EventType.CONTENT_UNPUBLISHED,
                  data: {
                    publicationId: active.id,
                    contentId,
                    contentSiteId,
                    revisionId: active.revisionId,
                    revisionNumber: active.revisionNumber,
                    slug: active.slug,
                    etag: active.etag,
                    scheduled: scheduleId !== undefined,
                    scheduleId,
                  },
                },
                transaction,
              );

              if (scheduleId) {
                await this.recordPublicationScheduleEffect(
                  {
                    scheduleId,
                    action: 'withdraw',
                    publication: withdrawnPublication,
                    replayed: false,
                  },
                  transaction,
                );
              }

              return Object.freeze({
                publication: freezePublication(withdrawnPublication),
                replayed: false,
              });
            });
          }
        """
    ).rstrip(),
    "target-aware scheduled withdrawal",
)
replace_once(
    content_service,
    "  private async assertActiveSlugAvailable(",
    dedent(
        """
          private async recordPublicationScheduleEffect(
            input: Readonly<{
              scheduleId: string;
              action: 'publish' | 'withdraw';
              publication: Readonly<ContentPublicationRecord>;
              replayed: boolean;
            }>,
            transaction: TTransaction,
          ): Promise<void> {
            if (!this.outboxService) {
              throw new DomainError({
                code: ErrorCode.INTERNAL_ERROR,
                message: 'Scheduled Publication requires a Transactional Outbox recorder.',
              });
            }

            await this.outboxService.record(
              {
                workspaceId: input.publication.workspaceId,
                siteId: input.publication.siteId,
                aggregateType: 'publication-schedule',
                aggregateId: input.scheduleId,
                eventType: EventType.PUBLICATION_SCHEDULE_EFFECT_APPLIED,
                data: {
                  scheduleId: input.scheduleId,
                  action: input.action,
                  publicationId: input.publication.id,
                  contentId: input.publication.contentId,
                  contentSiteId: input.publication.contentSiteId,
                  revisionId: input.publication.revisionId,
                  revisionNumber: input.publication.revisionNumber,
                  replayed: input.replayed,
                },
              },
              transaction,
            );
          }

          private async assertActiveSlugAvailable(
        """
    ).rstrip(),
    "schedule effect recorder",
)

# Explicit no-op handler for the durable effect marker.
outbox_consumer = "packages/server/src/modules/eventing/application/outbox-relay.service.ts"
replace_once(
    outbox_consumer,
    "    if (\n      event.eventType === EventType.PUBLICATION_SCHEDULE_REQUESTED ||",
    "    if (event.eventType === EventType.PUBLICATION_SCHEDULE_EFFECT_APPLIED) {\n      return 0;\n    }\n\n    if (\n      event.eventType === EventType.PUBLICATION_SCHEDULE_REQUESTED ||",
    "schedule effect no-op handler",
)

# Existing unit test command stubs now use the target-aware command contract.
eventing_test = "packages/server/src/eventing.test.ts"
replace_once(
    eventing_test,
    "    startPublicationScheduleAttempt: () => {\n      claimCount += 1;",
    "    startPublicationScheduleAttempt: () => {\n      claimCount += 1;",
    "processor test anchor",
)
replace_once(
    eventing_test,
    "    completePublicationSchedule: () => {\n      completeCount += 1;",
    "    hasPublicationScheduleEffect: () => Promise.resolve(false),\n    completePublicationSchedule: () => {\n      completeCount += 1;",
    "processor effect test stub",
)
replace_once(
    eventing_test,
    "  const command = {\n    publish: () => {\n      publishCount += 1;\n      return Promise.resolve({ replayed: false });\n    },\n    withdraw: () => Promise.resolve({ replayed: false }),\n  };",
    "  const command = {\n    publishScheduledRevision: () => {\n      publishCount += 1;\n      return Promise.resolve({ replayed: false });\n    },\n    withdrawScheduledPublication: () => Promise.resolve({ replayed: false }),\n  };",
    "processor command test stub",
)
replace_once(
    eventing_test,
    "    startPublicationScheduleAttempt: () => Promise.resolve(schedule),\n    reschedulePublicationSchedule:",
    "    startPublicationScheduleAttempt: () => Promise.resolve(schedule),\n    hasPublicationScheduleEffect: () => Promise.resolve(false),\n    reschedulePublicationSchedule:",
    "retry effect test stub",
)
replace_once(
    eventing_test,
    "  const command = {\n    publish: () => Promise.reject(new Error('temporary publication failure')),\n    withdraw: () => Promise.resolve(),\n  } satisfies PublicationCommandPort;",
    "  const command = {\n    publishScheduledRevision: () =>\n      Promise.reject(new Error('temporary publication failure')),\n    withdrawScheduledPublication: () => Promise.resolve({ replayed: false }),\n  } satisfies PublicationCommandPort;",
    "retry command test stub",
)

write(
    "packages/server/src/publication-scheduling-snapshot.test.ts",
    dedent(
        r"""
        import assert from 'node:assert/strict';
        import { test } from 'node:test';

        import {
          ActorType,
          FixedClock,
          PublicationScheduleAction,
          PublicationScheduleProcessor,
          PublicationScheduleStatus,
          PublicationSchedulingService,
          createUuidV7,
          requestContext,
          type AuditService,
          type EventingRepositoryPort,
          type OutboxService,
          type PublicationCommandPort,
          type PublicationScheduleRecord,
          type TransactionRunner,
        } from './index';

        test('Publication Scheduling snapshots the exact READY Revision', async () => {
          const clock = new FixedClock('2026-09-04T00:00:00.000Z');
          const workspaceId = createUuidV7(1);
          const contentId = createUuidV7(2);
          const contentSiteId = createUuidV7(3);
          const siteId = createUuidV7(4);
          const revisionId = createUuidV7(5);
          let inserted: PublicationScheduleRecord | undefined;
          const repository = {
            findContentSiteScheduleTarget: () =>
              Promise.resolve({
                workspaceId,
                siteId,
                siteStatus: 'active',
                siteTimezone: 'UTC',
                contentId,
                contentStatus: 'ready',
                contentSiteId,
                readyRevisionId: revisionId,
                readyRevisionNumber: 7,
              }),
            insertPublicationSchedule: (record: PublicationScheduleRecord) => {
              inserted = record;
              return Promise.resolve();
            },
          } as unknown as EventingRepositoryPort<symbol>;
          const service = new PublicationSchedulingService(
            passthroughRunner<symbol>(),
            repository,
            noOpAuditService<symbol>(),
            noOpOutboxService<symbol>(),
            clock,
          );

          const schedule = await runAsAdmin(workspaceId, () =>
            service.create(workspaceId, contentId, contentSiteId, {
              action: PublicationScheduleAction.PUBLISH,
              scheduledLocalAt: '2026-09-04T00:01:00',
              timezone: 'UTC',
            }),
          );

          assert.equal(inserted?.revisionId, revisionId);
          assert.equal(inserted?.revisionNumber, 7);
          assert.equal(inserted?.targetPublicationId, undefined);
          assert.equal(schedule.revisionId, revisionId);
          assert.equal(schedule.revisionNumber, 7);
        });

        test('Publication Scheduling snapshots the exact active Publication for withdrawal', async () => {
          const clock = new FixedClock('2026-09-04T00:00:00.000Z');
          const workspaceId = createUuidV7(11);
          const contentId = createUuidV7(12);
          const contentSiteId = createUuidV7(13);
          const siteId = createUuidV7(14);
          const publicationId = createUuidV7(15);
          let inserted: PublicationScheduleRecord | undefined;
          const repository = {
            findContentSiteScheduleTarget: () =>
              Promise.resolve({
                workspaceId,
                siteId,
                siteStatus: 'active',
                siteTimezone: 'UTC',
                contentId,
                contentStatus: 'ready',
                contentSiteId,
                activePublicationId: publicationId,
              }),
            insertPublicationSchedule: (record: PublicationScheduleRecord) => {
              inserted = record;
              return Promise.resolve();
            },
          } as unknown as EventingRepositoryPort<symbol>;
          const service = new PublicationSchedulingService(
            passthroughRunner<symbol>(),
            repository,
            noOpAuditService<symbol>(),
            noOpOutboxService<symbol>(),
            clock,
          );

          const schedule = await runAsAdmin(workspaceId, () =>
            service.create(workspaceId, contentId, contentSiteId, {
              action: PublicationScheduleAction.WITHDRAW,
              scheduledLocalAt: '2026-09-04T00:01:00',
              timezone: 'UTC',
            }),
          );

          assert.equal(inserted?.revisionId, undefined);
          assert.equal(inserted?.revisionNumber, undefined);
          assert.equal(inserted?.targetPublicationId, publicationId);
          assert.equal(schedule.targetPublicationId, publicationId);
        });

        test('Publication Schedule recovery trusts only its transactional effect marker', async () => {
          const clock = new FixedClock('2026-09-04T00:00:00.000Z');
          const schedule = createSchedule(clock);
          let commandCalls = 0;
          let completed = 0;
          const repository = {
            startPublicationScheduleAttempt: () => Promise.resolve(schedule),
            hasPublicationScheduleEffect: () => Promise.resolve(true),
            completePublicationSchedule: () => {
              completed += 1;
              return Promise.resolve();
            },
          } as unknown as EventingRepositoryPort<symbol>;
          const command: PublicationCommandPort = {
            publishScheduledRevision: () => {
              commandCalls += 1;
              return Promise.resolve({ replayed: false });
            },
            withdrawScheduledPublication: () => {
              commandCalls += 1;
              return Promise.resolve({ replayed: false });
            },
          };
          const processor = new PublicationScheduleProcessor(
            passthroughRunner<symbol>(),
            repository,
            command,
            noOpAuditService<symbol>(),
            clock,
          );

          await processor.process(schedule.id, 1);

          assert.equal(commandCalls, 0);
          assert.equal(completed, 1);
        });

        function createSchedule(clock: FixedClock): PublicationScheduleRecord {
          return {
            id: createUuidV7(21),
            workspaceId: createUuidV7(22),
            siteId: createUuidV7(23),
            contentId: createUuidV7(24),
            contentSiteId: createUuidV7(25),
            revisionId: createUuidV7(26),
            revisionNumber: 3,
            action: PublicationScheduleAction.PUBLISH,
            scheduledFor: clock.now(),
            timezone: 'UTC',
            scheduledLocalAt: '2026-09-04T00:00:00',
            status: PublicationScheduleStatus.PROCESSING,
            attemptCount: 1,
            nextAttemptAt: clock.now(),
            version: 2,
            requestedByAdminAccountId: createUuidV7(27),
            createdAt: clock.now(),
            updatedAt: clock.now(),
          };
        }

        function passthroughRunner<TTransaction>(): TransactionRunner<TTransaction> {
          return {
            run: <TResult>(work: (transaction: TTransaction) => Promise<TResult>) =>
              work(Symbol('transaction') as TTransaction),
          };
        }

        function noOpAuditService<TTransaction>(): AuditService<TTransaction> {
          return { record: () => Promise.resolve({}) } as unknown as AuditService<TTransaction>;
        }

        function noOpOutboxService<TTransaction>(): OutboxService<TTransaction> {
          return { record: () => Promise.resolve({}) } as unknown as OutboxService<TTransaction>;
        }

        function runAsAdmin<TResult>(
          workspaceId: string,
          work: () => Promise<TResult>,
        ): Promise<TResult> {
          return requestContext.run(
            {
              requestId: createUuidV7(),
              traceId: createUuidV7(),
              actorType: ActorType.ADMIN,
              actorId: createUuidV7(),
              workspaceId,
            },
            work,
          );
        }
        """
    ),
)

# ---------------------------------------------------------------------------
# Real Eventing gate now verifies both target types and READY pointer drift.
# ---------------------------------------------------------------------------
e2e_path = "scripts/ci/eventing-e2e.mjs"
replace_once(
    e2e_path,
    "    const content = await createReadyContent(request, session, mainBlog);",
    "    let content = await createReadyContent(request, session, mainBlog);",
    "mutable Eventing content",
)
replace_once(
    e2e_path,
    "    await request(`/admin/v1/contents/${content.id}/sites/${content.assignmentId}/publish`, {\n      method: 'POST',\n      expectedStatus: 201,\n      cookieHeader: session.cookieHeader,\n      csrfToken: session.csrfToken,\n    });\n\n    const firstFailure =",
    "    const initialPublication = (\n      await request(`/admin/v1/contents/${content.id}/sites/${content.assignmentId}/publish`, {\n        method: 'POST',\n        expectedStatus: 201,\n        cookieHeader: session.cookieHeader,\n        csrfToken: session.csrfToken,\n      })\n    ).data;\n\n    const firstFailure =",
    "capture initial publication",
)
replace_once(
    e2e_path,
    "    assertEqual(schedule.data.action, 'withdraw', 'Publication Schedule action');",
    "    assertEqual(schedule.data.action, 'withdraw', 'Publication Schedule action');\n    assertEqual(\n      schedule.data.targetPublicationId,\n      initialPublication.id,\n      'Scheduled withdrawal Publication target',\n    );",
    "assert withdrawal target",
)
insert_marker = "    await request(`/admin/v1/contents/${content.id}/sites/${content.assignmentId}/publish`, {\n      method: 'POST',\n      expectedStatus: 201,\n      cookieHeader: session.cookieHeader,\n      csrfToken: session.csrfToken,\n    });\n    await waitForReceiverEvent(receiver, 'content.published', 3);"
replacement = dedent(
    """
        const scheduledRevisionNumber = content.readyRevisionNumber;
        const scheduledPublish = await request(
          `/admin/v1/contents/${content.id}/sites/${content.assignmentId}/schedules`,
          {
            method: 'POST',
            body: {
              action: 'publish',
              scheduledLocalAt: formatLocalDateTime(new Date(Date.now() + 45_000), 'Asia/Seoul'),
              timezone: 'Asia/Seoul',
            },
            expectedStatus: 201,
            cookieHeader: session.cookieHeader,
            csrfToken: session.csrfToken,
          },
        );
        assertEqual(
          scheduledPublish.data.revisionNumber,
          scheduledRevisionNumber,
          'Scheduled publish Revision target',
        );

        content = (
          await request(`/admin/v1/contents/${content.id}/draft`, {
            method: 'PATCH',
            body: {
              draftVersion: content.draft.draftVersion,
              title: 'Atlas Eventing E2E v2',
              summary: 'READY pointer moved after scheduling',
              bodyMarkdown:
                'This newer READY Revision must not replace the immutable scheduled Revision target.',
            },
            expectedStatus: 200,
            cookieHeader: session.cookieHeader,
            csrfToken: session.csrfToken,
          })
        ).data;
        content = (
          await request(`/admin/v1/contents/${content.id}/ready`, {
            method: 'POST',
            body: {
              contentVersion: content.version,
              draftVersion: content.draft.draftVersion,
              note: 'Eventing E2E newer READY Revision',
            },
            expectedStatus: 201,
            cookieHeader: session.cookieHeader,
            csrfToken: session.csrfToken,
          })
        ).data;
        assertEqual(
          content.readyRevisionNumber,
          scheduledRevisionNumber + 1,
          'READY Revision moved after scheduling',
        );

        await waitForSchedule(request, session, scheduledPublish.data.id, 'completed');
        const scheduledHistory = await request(
          `/admin/v1/contents/${content.id}/sites/${content.assignmentId}/publications`,
          {
            expectedStatus: 200,
            cookieHeader: session.cookieHeader,
          },
        );
        const scheduledActive = scheduledHistory.data.find(
          (publication) => publication.status === 'active',
        );
        assertEqual(
          scheduledActive?.revisionNumber,
          scheduledRevisionNumber,
          'Scheduled publish must use its immutable Revision target',
        );
        await waitForReceiverEvent(receiver, 'content.published', 3);
        verifyCapturedRequest(
          receiver.requests.findLast((item) => item.eventType === 'content.published'),
          secret,
          'content.published',
        );

        await request(`/admin/v1/contents/${content.id}/sites/${content.assignmentId}/publish`, {
          method: 'POST',
          expectedStatus: 201,
          cookieHeader: session.cookieHeader,
          csrfToken: session.csrfToken,
        });
        await waitForReceiverEvent(receiver, 'content.published', 4);
    """
).rstrip()
replace_once(e2e_path, insert_marker, replacement, "scheduled publish drift E2E")
replace_once(
    e2e_path,
    "        (item) => item.id === schedule.data.id && item.status === 'completed',\n      ) ||\n      !schedules.data.items.some(\n        (item) => item.id === cancellable.data.id && item.status === 'cancelled',",
    "        (item) => item.id === schedule.data.id && item.status === 'completed',\n      ) ||\n      !schedules.data.items.some(\n        (item) => item.id === scheduledPublish.data.id && item.status === 'completed',\n      ) ||\n      !schedules.data.items.some(\n        (item) => item.id === cancellable.data.id && item.status === 'cancelled',",
    "schedule history includes publish target",
)

workflow_path = ".github/workflows/eventing-data-gate.yml"
replace_once(workflow_path, "WHERE status = 'dispatched')\" -ge 8", "WHERE status = 'dispatched')\" -ge 12", "outbox count")
replace_once(workflow_path, "FROM event_consumptions WHERE status = 'succeeded')\" -ge 8", "FROM event_consumptions WHERE status = 'succeeded')\" -ge 12", "consumption count")
replace_once(workflow_path, "SELECT count(*) FROM webhook_deliveries')\" -eq 3", "SELECT count(*) FROM webhook_deliveries')\" -eq 4", "delivery count")
replace_once(workflow_path, "WHERE status = 'succeeded')\" -eq 3", "WHERE status = 'succeeded')\" -eq 4", "delivery success count")
replace_once(workflow_path, "FROM webhook_delivery_attempts WHERE status = 'succeeded')\" -eq 3", "FROM webhook_delivery_attempts WHERE status = 'succeeded')\" -eq 4", "attempt success count")
replace_once(workflow_path, "FROM publication_schedules WHERE status = 'completed')\" -eq 1", "FROM publication_schedules WHERE status = 'completed')\" -eq 2", "completed schedule count")
replace_once(workflow_path, "WHERE action = 'content.publication-scheduled')\" -eq 2", "WHERE action = 'content.publication-scheduled')\" -eq 3", "schedule audit count")
replace_once(
    workflow_path,
    "          test \"$(psql \"$DATABASE_URL\" -Atc \"SELECT count(*) FROM publication_schedules WHERE status IN ('pending', 'processing', 'failed')\")\" -eq 0",
    "          test \"$(psql \"$DATABASE_URL\" -Atc \"SELECT count(*) FROM publication_schedules WHERE status IN ('pending', 'processing', 'failed')\")\" -eq 0\n          test \"$(psql \"$DATABASE_URL\" -Atc \"SELECT count(*) FROM publication_schedules WHERE action = 'publish' AND revision_id IS NOT NULL AND revision_number IS NOT NULL AND target_publication_id IS NULL\")\" -eq 1\n          test \"$(psql \"$DATABASE_URL\" -Atc \"SELECT count(*) FROM publication_schedules WHERE action = 'withdraw' AND revision_id IS NULL AND revision_number IS NULL AND target_publication_id IS NOT NULL\")\" -eq 2\n          test \"$(psql \"$DATABASE_URL\" -Atc \"SELECT count(*) FROM outbox_events WHERE aggregate_type = 'publication-schedule' AND event_type = 'publication.schedule.effect-applied'\")\" -eq 2",
    "schedule target database assertions",
)

print("Phase 9 immutable schedule target patch applied.")
