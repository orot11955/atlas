import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLogs1788000300000 implements MigrationInterface {
  public readonly name = 'CreateAuditLogs1788000300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL,
        "workspace_id" uuid,
        "site_id" uuid,
        "actor_type" varchar(32) NOT NULL,
        "actor_id" varchar(128),
        "action" varchar(128) NOT NULL,
        "target_type" varchar(128) NOT NULL,
        "target_id" varchar(128),
        "request_id" varchar(128) NOT NULL,
        "trace_id" varchar(128) NOT NULL,
        "correlation_id" varchar(128),
        "result" varchar(16) NOT NULL,
        "error_code" varchar(64),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "occurred_at" timestamptz NOT NULL,
        CONSTRAINT "pk_audit_logs" PRIMARY KEY ("id"),
        CONSTRAINT "chk_audit_logs_actor_type" CHECK (
          "actor_type" IN ('anonymous', 'admin', 'member', 'api-client', 'system')
        ),
        CONSTRAINT "chk_audit_logs_result" CHECK (
          "result" IN ('success', 'denied', 'failure')
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_audit_logs_workspace_occurred_at"
      ON "audit_logs" ("workspace_id", "occurred_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_audit_logs_request_id"
      ON "audit_logs" ("request_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_audit_logs_actor_occurred_at"
      ON "audit_logs" ("actor_type", "actor_id", "occurred_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_audit_logs_target_occurred_at"
      ON "audit_logs" ("target_type", "target_id", "occurred_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "audit_logs"');
  }
}
