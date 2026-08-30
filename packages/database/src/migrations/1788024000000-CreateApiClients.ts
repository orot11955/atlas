import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateApiClients1788024000000 implements MigrationInterface {
  public readonly name = 'CreateApiClients1788024000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "api_clients" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "description" varchar(500),
        "type" varchar(24) NOT NULL,
        "status" varchar(24) NOT NULL,
        "rate_limit_per_minute" integer NOT NULL,
        "require_origin" boolean NOT NULL DEFAULT false,
        "version" integer NOT NULL DEFAULT 1,
        "disabled_at" timestamptz,
        "archived_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_api_clients" PRIMARY KEY ("id"),
        CONSTRAINT "uq_api_clients_id_workspace" UNIQUE ("id", "workspace_id"),
        CONSTRAINT "fk_api_clients_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_api_clients_name"
          CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
        CONSTRAINT "chk_api_clients_type"
          CHECK ("type" IN ('delivery', 'integration')),
        CONSTRAINT "chk_api_clients_status"
          CHECK ("status" IN ('active', 'disabled', 'archived')),
        CONSTRAINT "chk_api_clients_rate_limit"
          CHECK ("rate_limit_per_minute" BETWEEN 1 AND 100000),
        CONSTRAINT "chk_api_clients_version" CHECK ("version" >= 1),
        CONSTRAINT "chk_api_clients_status_timestamps" CHECK (
          ("status" = 'active' AND "disabled_at" IS NULL AND "archived_at" IS NULL)
          OR ("status" = 'disabled' AND "disabled_at" IS NOT NULL AND "archived_at" IS NULL)
          OR ("status" = 'archived' AND "archived_at" IS NOT NULL)
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_api_clients_workspace_status_created"
      ON "api_clients" ("workspace_id", "status", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "api_client_site_access" (
        "api_client_id" uuid NOT NULL,
        "site_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_api_client_site_access"
          PRIMARY KEY ("api_client_id", "site_id"),
        CONSTRAINT "fk_api_client_site_access_client_workspace"
          FOREIGN KEY ("api_client_id", "workspace_id")
          REFERENCES "api_clients" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "fk_api_client_site_access_site_workspace"
          FOREIGN KEY ("site_id", "workspace_id")
          REFERENCES "sites" ("id", "workspace_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_api_client_site_access_workspace_site"
      ON "api_client_site_access" ("workspace_id", "site_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "api_client_scopes" (
        "api_client_id" uuid NOT NULL,
        "scope" varchar(64) NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_api_client_scopes" PRIMARY KEY ("api_client_id", "scope"),
        CONSTRAINT "fk_api_client_scopes_client"
          FOREIGN KEY ("api_client_id") REFERENCES "api_clients" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_api_client_scopes_value" CHECK (
          "scope" IN (
            'site:read',
            'content:read',
            'feed:read',
            'release:write',
            'deployment:create',
            'deployment:update',
            'health:write'
          )
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "api_client_allowed_origins" (
        "api_client_id" uuid NOT NULL,
        "origin" varchar(512) NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_api_client_allowed_origins"
          PRIMARY KEY ("api_client_id", "origin"),
        CONSTRAINT "fk_api_client_allowed_origins_client"
          FOREIGN KEY ("api_client_id") REFERENCES "api_clients" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_api_client_allowed_origins_value"
          CHECK ("origin" ~ '^https?://[^/]+$')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "api_client_keys" (
        "id" uuid NOT NULL,
        "api_client_id" uuid NOT NULL,
        "key_prefix" varchar(64) NOT NULL,
        "secret_digest" char(64) NOT NULL,
        "created_at" timestamptz NOT NULL,
        "expires_at" timestamptz,
        "grace_expires_at" timestamptz,
        "replaced_by_key_id" uuid,
        "revoked_at" timestamptz,
        "last_used_at" timestamptz,
        CONSTRAINT "pk_api_client_keys" PRIMARY KEY ("id"),
        CONSTRAINT "uq_api_client_keys_prefix" UNIQUE ("key_prefix"),
        CONSTRAINT "uq_api_client_keys_digest" UNIQUE ("secret_digest"),
        CONSTRAINT "fk_api_client_keys_client"
          FOREIGN KEY ("api_client_id") REFERENCES "api_clients" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_api_client_keys_replacement"
          FOREIGN KEY ("replaced_by_key_id") REFERENCES "api_client_keys" ("id")
          DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT "chk_api_client_keys_prefix"
          CHECK ("key_prefix" ~ '^atlas_live_[0-9a-f-]{36}$'),
        CONSTRAINT "chk_api_client_keys_digest"
          CHECK ("secret_digest" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "chk_api_client_keys_expiration"
          CHECK ("expires_at" IS NULL OR "expires_at" > "created_at"),
        CONSTRAINT "chk_api_client_keys_rotation" CHECK (
          ("replaced_by_key_id" IS NULL AND "grace_expires_at" IS NULL)
          OR (
            "replaced_by_key_id" IS NOT NULL
            AND "grace_expires_at" IS NOT NULL
            AND "grace_expires_at" >= "created_at"
          )
        ),
        CONSTRAINT "chk_api_client_keys_revocation"
          CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at"),
        CONSTRAINT "chk_api_client_keys_usage"
          CHECK ("last_used_at" IS NULL OR "last_used_at" >= "created_at")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_api_client_keys_current"
      ON "api_client_keys" ("api_client_id")
      WHERE "revoked_at" IS NULL AND "replaced_by_key_id" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_api_client_keys_client_created"
      ON "api_client_keys" ("api_client_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "api_client_keys"');
    await queryRunner.query('DROP TABLE "api_client_allowed_origins"');
    await queryRunner.query('DROP TABLE "api_client_scopes"');
    await queryRunner.query('DROP TABLE "api_client_site_access"');
    await queryRunner.query('DROP TABLE "api_clients"');
  }
}
