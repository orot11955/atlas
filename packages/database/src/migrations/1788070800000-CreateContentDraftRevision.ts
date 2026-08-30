import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateContentDraftRevision1788070800000
  implements MigrationInterface
{
  public readonly name = 'CreateContentDraftRevision1788070800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "contents" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "type" varchar(24) NOT NULL,
        "status" varchar(24) NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "current_revision_number" integer,
        "ready_revision_number" integer,
        "archived_at" timestamptz,
        "created_by_admin_account_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_contents" PRIMARY KEY ("id"),
        CONSTRAINT "uq_contents_id_workspace" UNIQUE ("id", "workspace_id"),
        CONSTRAINT "fk_contents_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_contents_created_by"
          FOREIGN KEY ("created_by_admin_account_id") REFERENCES "admin_accounts" ("id"),
        CONSTRAINT "chk_contents_type"
          CHECK ("type" IN ('post', 'page', 'document')),
        CONSTRAINT "chk_contents_status"
          CHECK ("status" IN ('draft', 'ready', 'archived')),
        CONSTRAINT "chk_contents_version" CHECK ("version" >= 1),
        CONSTRAINT "chk_contents_current_revision"
          CHECK ("current_revision_number" IS NULL OR "current_revision_number" >= 1),
        CONSTRAINT "chk_contents_ready_revision"
          CHECK ("ready_revision_number" IS NULL OR "ready_revision_number" >= 1),
        CONSTRAINT "chk_contents_ready_state"
          CHECK ("status" <> 'ready' OR "ready_revision_number" IS NOT NULL),
        CONSTRAINT "chk_contents_archived_at" CHECK (
          ("status" = 'archived' AND "archived_at" IS NOT NULL)
          OR ("status" <> 'archived' AND "archived_at" IS NULL)
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_contents_workspace_status_updated"
      ON "contents" ("workspace_id", "status", "updated_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "content_drafts" (
        "content_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "title" varchar(200) NOT NULL DEFAULT '',
        "summary" varchar(500),
        "body_markdown" text NOT NULL DEFAULT '',
        "draft_version" integer NOT NULL DEFAULT 1,
        "updated_by_admin_account_id" uuid NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_content_drafts" PRIMARY KEY ("content_id"),
        CONSTRAINT "fk_content_drafts_content_workspace"
          FOREIGN KEY ("content_id", "workspace_id")
          REFERENCES "contents" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "fk_content_drafts_updated_by"
          FOREIGN KEY ("updated_by_admin_account_id") REFERENCES "admin_accounts" ("id"),
        CONSTRAINT "chk_content_drafts_title" CHECK (char_length("title") <= 200),
        CONSTRAINT "chk_content_drafts_summary"
          CHECK ("summary" IS NULL OR char_length("summary") <= 500),
        CONSTRAINT "chk_content_drafts_body"
          CHECK (char_length("body_markdown") <= 500000),
        CONSTRAINT "chk_content_drafts_version" CHECK ("draft_version" >= 1)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_content_drafts_workspace_updated"
      ON "content_drafts" ("workspace_id", "updated_at" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "content_revisions" (
        "id" uuid NOT NULL,
        "content_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "revision_number" integer NOT NULL,
        "kind" varchar(24) NOT NULL,
        "title" varchar(200) NOT NULL,
        "summary" varchar(500),
        "body_markdown" text NOT NULL,
        "body_html" text NOT NULL,
        "source_draft_version" integer NOT NULL,
        "note" varchar(300),
        "created_by_admin_account_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_content_revisions" PRIMARY KEY ("id"),
        CONSTRAINT "uq_content_revisions_number"
          UNIQUE ("content_id", "revision_number"),
        CONSTRAINT "uq_content_revisions_id_workspace"
          UNIQUE ("id", "workspace_id"),
        CONSTRAINT "fk_content_revisions_content_workspace"
          FOREIGN KEY ("content_id", "workspace_id")
          REFERENCES "contents" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "fk_content_revisions_created_by"
          FOREIGN KEY ("created_by_admin_account_id") REFERENCES "admin_accounts" ("id"),
        CONSTRAINT "chk_content_revisions_number" CHECK ("revision_number" >= 1),
        CONSTRAINT "chk_content_revisions_kind"
          CHECK ("kind" IN ('checkpoint', 'ready')),
        CONSTRAINT "chk_content_revisions_title" CHECK (char_length("title") <= 200),
        CONSTRAINT "chk_content_revisions_summary"
          CHECK ("summary" IS NULL OR char_length("summary") <= 500),
        CONSTRAINT "chk_content_revisions_body_markdown"
          CHECK (char_length("body_markdown") <= 500000),
        CONSTRAINT "chk_content_revisions_source_version"
          CHECK ("source_draft_version" >= 1),
        CONSTRAINT "chk_content_revisions_note"
          CHECK ("note" IS NULL OR char_length("note") <= 300)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_content_revisions_workspace_content_created"
      ON "content_revisions" (
        "workspace_id",
        "content_id",
        "created_at" DESC,
        "revision_number" DESC
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "contents"
      ADD CONSTRAINT "fk_contents_current_revision"
      FOREIGN KEY ("id", "current_revision_number")
      REFERENCES "content_revisions" ("content_id", "revision_number")
      DEFERRABLE INITIALLY DEFERRED
    `);

    await queryRunner.query(`
      ALTER TABLE "contents"
      ADD CONSTRAINT "fk_contents_ready_revision"
      FOREIGN KEY ("id", "ready_revision_number")
      REFERENCES "content_revisions" ("content_id", "revision_number")
      DEFERRABLE INITIALLY DEFERRED
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "prevent_content_revision_mutation"()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'content revisions are immutable';
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER "trg_content_revisions_immutable"
      BEFORE UPDATE OR DELETE ON "content_revisions"
      FOR EACH ROW EXECUTE FUNCTION "prevent_content_revision_mutation"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "trg_content_revisions_immutable" ON "content_revisions"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS "prevent_content_revision_mutation"()',
    );
    await queryRunner.query(
      'ALTER TABLE "contents" DROP CONSTRAINT IF EXISTS "fk_contents_ready_revision"',
    );
    await queryRunner.query(
      'ALTER TABLE "contents" DROP CONSTRAINT IF EXISTS "fk_contents_current_revision"',
    );
    await queryRunner.query('DROP TABLE "content_revisions"');
    await queryRunner.query('DROP TABLE "content_drafts"');
    await queryRunner.query('DROP TABLE "contents"');
  }
}
