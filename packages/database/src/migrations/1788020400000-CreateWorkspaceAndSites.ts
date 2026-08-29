import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkspaceAndSites1788020400000 implements MigrationInterface {
  public readonly name = 'CreateWorkspaceAndSites1788020400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "workspaces" (
        "id" uuid NOT NULL,
        "key" varchar(64) NOT NULL,
        "name" varchar(120) NOT NULL,
        "timezone" varchar(64) NOT NULL,
        "locale" varchar(32) NOT NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_workspaces" PRIMARY KEY ("id"),
        CONSTRAINT "uq_workspaces_key" UNIQUE ("key"),
        CONSTRAINT "chk_workspaces_key"
          CHECK ("key" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
        CONSTRAINT "chk_workspaces_name"
          CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
        CONSTRAINT "chk_workspaces_version" CHECK ("version" >= 1)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_workspaces_default"
      ON "workspaces" ("is_default")
      WHERE "is_default" = true
    `);

    await queryRunner.query(`
      INSERT INTO "workspaces" (
        "id",
        "key",
        "name",
        "timezone",
        "locale",
        "is_default",
        "version",
        "created_at",
        "updated_at"
      ) VALUES (
        '00000000-0000-7000-8000-000000000001',
        'default',
        'Atlas',
        'Asia/Seoul',
        'ko-KR',
        true,
        1,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "sites" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "key" varchar(64) NOT NULL,
        "name" varchar(120) NOT NULL,
        "description" varchar(500),
        "type" varchar(24) NOT NULL,
        "status" varchar(24) NOT NULL,
        "timezone" varchar(64) NOT NULL,
        "locale" varchar(32) NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "archived_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_sites" PRIMARY KEY ("id"),
        CONSTRAINT "uq_sites_id_workspace" UNIQUE ("id", "workspace_id"),
        CONSTRAINT "uq_sites_workspace_key" UNIQUE ("workspace_id", "key"),
        CONSTRAINT "fk_sites_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_sites_key"
          CHECK ("key" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
        CONSTRAINT "chk_sites_name"
          CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
        CONSTRAINT "chk_sites_type"
          CHECK ("type" IN ('blog', 'portfolio', 'docs', 'photo', 'other')),
        CONSTRAINT "chk_sites_status"
          CHECK ("status" IN ('draft', 'active', 'maintenance', 'disabled', 'archived')),
        CONSTRAINT "chk_sites_version" CHECK ("version" >= 1),
        CONSTRAINT "chk_sites_archived_at" CHECK (
          ("status" = 'archived' AND "archived_at" IS NOT NULL)
          OR ("status" <> 'archived' AND "archived_at" IS NULL)
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_sites_workspace_status_created"
      ON "sites" ("workspace_id", "status", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "site_domains" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "site_id" uuid NOT NULL,
        "hostname" varchar(253) NOT NULL,
        "kind" varchar(16) NOT NULL,
        "verification_status" varchar(16) NOT NULL,
        "verification_token_digest" char(64),
        "verified_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_site_domains" PRIMARY KEY ("id"),
        CONSTRAINT "uq_site_domains_workspace_hostname"
          UNIQUE ("workspace_id", "hostname"),
        CONSTRAINT "fk_site_domains_site_workspace"
          FOREIGN KEY ("site_id", "workspace_id")
          REFERENCES "sites" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "chk_site_domains_kind" CHECK ("kind" IN ('canonical', 'alias')),
        CONSTRAINT "chk_site_domains_verification_status"
          CHECK ("verification_status" IN ('pending', 'verified', 'failed')),
        CONSTRAINT "chk_site_domains_token_digest" CHECK (
          "verification_token_digest" IS NULL
          OR "verification_token_digest" ~ '^[0-9a-f]{64}$'
        ),
        CONSTRAINT "chk_site_domains_verified_at" CHECK (
          ("verification_status" = 'verified' AND "verified_at" IS NOT NULL)
          OR ("verification_status" <> 'verified' AND "verified_at" IS NULL)
        )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_site_domains_canonical"
      ON "site_domains" ("site_id")
      WHERE "kind" = 'canonical'
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_site_domains_site_kind"
      ON "site_domains" ("site_id", "kind")
    `);

    await queryRunner.query(`
      CREATE TABLE "site_settings" (
        "site_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "branding_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "seo_defaults_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "version" integer NOT NULL DEFAULT 1,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_site_settings" PRIMARY KEY ("site_id"),
        CONSTRAINT "fk_site_settings_site_workspace"
          FOREIGN KEY ("site_id", "workspace_id")
          REFERENCES "sites" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "chk_site_settings_branding_object"
          CHECK (jsonb_typeof("branding_json") = 'object'),
        CONSTRAINT "chk_site_settings_seo_object"
          CHECK (jsonb_typeof("seo_defaults_json") = 'object'),
        CONSTRAINT "chk_site_settings_version" CHECK ("version" >= 1)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "site_settings"');
    await queryRunner.query('DROP TABLE "site_domains"');
    await queryRunner.query('DROP TABLE "sites"');
    await queryRunner.query('DROP TABLE "workspaces"');
  }
}
