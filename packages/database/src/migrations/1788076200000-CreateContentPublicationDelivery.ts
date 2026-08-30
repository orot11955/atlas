import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateContentPublicationDelivery1788076200000 implements MigrationInterface {
  public readonly name = 'CreateContentPublicationDelivery1788076200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "content_sites" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "content_id" uuid NOT NULL,
        "site_id" uuid NOT NULL,
        "slug" varchar(160) NOT NULL,
        "title_override" varchar(200),
        "summary_override" varchar(500),
        "seo_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "visibility" varchar(16) NOT NULL DEFAULT 'public',
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_content_sites" PRIMARY KEY ("id"),
        CONSTRAINT "uq_content_sites_id_workspace" UNIQUE ("id", "workspace_id"),
        CONSTRAINT "uq_content_sites_content_site"
          UNIQUE ("workspace_id", "content_id", "site_id"),
        CONSTRAINT "uq_content_sites_site_slug"
          UNIQUE ("workspace_id", "site_id", "slug"),
        CONSTRAINT "fk_content_sites_content_workspace"
          FOREIGN KEY ("content_id", "workspace_id")
          REFERENCES "contents" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "fk_content_sites_site_workspace"
          FOREIGN KEY ("site_id", "workspace_id")
          REFERENCES "sites" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "chk_content_sites_slug"
          CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
        CONSTRAINT "chk_content_sites_title_override"
          CHECK ("title_override" IS NULL OR char_length("title_override") BETWEEN 1 AND 200),
        CONSTRAINT "chk_content_sites_summary_override"
          CHECK ("summary_override" IS NULL OR char_length("summary_override") BETWEEN 1 AND 500),
        CONSTRAINT "chk_content_sites_visibility"
          CHECK ("visibility" IN ('public', 'unlisted', 'private')),
        CONSTRAINT "chk_content_sites_version" CHECK ("version" >= 1),
        CONSTRAINT "chk_content_sites_seo_object"
          CHECK (jsonb_typeof("seo_json") = 'object'),
        CONSTRAINT "chk_content_sites_seo_size"
          CHECK (octet_length("seo_json"::text) <= 16384)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_content_sites_workspace_content"
      ON "content_sites" ("workspace_id", "content_id", "created_at", "id")
    `);

    await queryRunner.query(`
      CREATE TABLE "content_publications" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "content_site_id" uuid NOT NULL,
        "content_id" uuid NOT NULL,
        "content_type" varchar(24) NOT NULL,
        "site_id" uuid NOT NULL,
        "site_key" varchar(64) NOT NULL,
        "site_name" varchar(120) NOT NULL,
        "revision_id" uuid NOT NULL,
        "revision_number" integer NOT NULL,
        "status" varchar(16) NOT NULL,
        "slug" varchar(160) NOT NULL,
        "title" varchar(200) NOT NULL,
        "summary" varchar(500),
        "body_html" text NOT NULL,
        "seo_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "visibility" varchar(16) NOT NULL,
        "etag" char(64) NOT NULL,
        "published_at" timestamptz NOT NULL,
        "superseded_at" timestamptz,
        "withdrawn_at" timestamptz,
        "created_by_admin_account_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_content_publications" PRIMARY KEY ("id"),
        CONSTRAINT "uq_content_publications_id_workspace" UNIQUE ("id", "workspace_id"),
        CONSTRAINT "fk_content_publications_content_site_workspace"
          FOREIGN KEY ("content_site_id", "workspace_id")
          REFERENCES "content_sites" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "fk_content_publications_content_workspace"
          FOREIGN KEY ("content_id", "workspace_id")
          REFERENCES "contents" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "fk_content_publications_site_workspace"
          FOREIGN KEY ("site_id", "workspace_id")
          REFERENCES "sites" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "fk_content_publications_revision_workspace"
          FOREIGN KEY ("revision_id", "workspace_id")
          REFERENCES "content_revisions" ("id", "workspace_id") ON DELETE RESTRICT,
        CONSTRAINT "fk_content_publications_created_by"
          FOREIGN KEY ("created_by_admin_account_id")
          REFERENCES "admin_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_content_publications_type"
          CHECK ("content_type" IN ('post', 'page', 'document')),
        CONSTRAINT "chk_content_publications_status"
          CHECK ("status" IN ('active', 'superseded', 'withdrawn')),
        CONSTRAINT "chk_content_publications_site_key"
          CHECK (
            char_length("site_key") BETWEEN 2 AND 64
            AND "site_key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
          ),
        CONSTRAINT "chk_content_publications_site_name"
          CHECK (char_length("site_name") BETWEEN 1 AND 120),
        CONSTRAINT "chk_content_publications_slug"
          CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
        CONSTRAINT "chk_content_publications_title"
          CHECK (char_length("title") BETWEEN 1 AND 200),
        CONSTRAINT "chk_content_publications_summary"
          CHECK ("summary" IS NULL OR char_length("summary") BETWEEN 1 AND 500),
        CONSTRAINT "chk_content_publications_revision_number"
          CHECK ("revision_number" >= 1),
        CONSTRAINT "chk_content_publications_visibility"
          CHECK ("visibility" IN ('public', 'unlisted', 'private')),
        CONSTRAINT "chk_content_publications_etag"
          CHECK ("etag" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "chk_content_publications_seo_object"
          CHECK (jsonb_typeof("seo_json") = 'object'),
        CONSTRAINT "chk_content_publications_seo_size"
          CHECK (octet_length("seo_json"::text) <= 16384),
        CONSTRAINT "chk_content_publications_status_time" CHECK (
          ("status" = 'active' AND "superseded_at" IS NULL AND "withdrawn_at" IS NULL)
          OR (
            "status" = 'superseded'
            AND "superseded_at" IS NOT NULL
            AND "withdrawn_at" IS NULL
          )
          OR (
            "status" = 'withdrawn'
            AND "withdrawn_at" IS NOT NULL
            AND "superseded_at" IS NULL
          )
        )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_content_publications_active_content_site"
      ON "content_publications" ("workspace_id", "content_site_id")
      WHERE "status" = 'active'
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_content_publications_active_site_slug"
      ON "content_publications" ("workspace_id", "site_id", "slug")
      WHERE "status" = 'active'
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_content_publications_history"
      ON "content_publications" (
        "workspace_id",
        "content_site_id",
        "published_at" DESC,
        "id" DESC
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_content_publications_delivery"
      ON "content_publications" (
        "workspace_id",
        "site_id",
        "status",
        "visibility",
        "published_at" DESC,
        "id" DESC
      )
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "protect_content_publication_snapshot"()
      RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'content publication snapshots cannot be deleted';
        END IF;

        IF OLD.status <> 'active' THEN
          RAISE EXCEPTION 'finalized content publication lifecycle cannot be changed';
        END IF;

        IF NEW.status NOT IN ('superseded', 'withdrawn') THEN
          RAISE EXCEPTION 'active content publication can only be superseded or withdrawn';
        END IF;

        IF ROW(
          NEW.id,
          NEW.workspace_id,
          NEW.content_site_id,
          NEW.content_id,
          NEW.content_type,
          NEW.site_id,
          NEW.site_key,
          NEW.site_name,
          NEW.revision_id,
          NEW.revision_number,
          NEW.slug,
          NEW.title,
          NEW.summary,
          NEW.body_html,
          NEW.seo_json,
          NEW.visibility,
          NEW.etag,
          NEW.published_at,
          NEW.created_by_admin_account_id,
          NEW.created_at
        ) IS DISTINCT FROM ROW(
          OLD.id,
          OLD.workspace_id,
          OLD.content_site_id,
          OLD.content_id,
          OLD.content_type,
          OLD.site_id,
          OLD.site_key,
          OLD.site_name,
          OLD.revision_id,
          OLD.revision_number,
          OLD.slug,
          OLD.title,
          OLD.summary,
          OLD.body_html,
          OLD.seo_json,
          OLD.visibility,
          OLD.etag,
          OLD.published_at,
          OLD.created_by_admin_account_id,
          OLD.created_at
        ) THEN
          RAISE EXCEPTION 'content publication snapshot fields are immutable';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER "trg_content_publications_protect_snapshot"
      BEFORE UPDATE OR DELETE ON "content_publications"
      FOR EACH ROW EXECUTE FUNCTION "protect_content_publication_snapshot"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "trg_content_publications_protect_snapshot" ON "content_publications"',
    );
    await queryRunner.query('DROP FUNCTION IF EXISTS "protect_content_publication_snapshot"()');
    await queryRunner.query('DROP TABLE "content_publications"');
    await queryRunner.query('DROP TABLE "content_sites"');
  }
}
