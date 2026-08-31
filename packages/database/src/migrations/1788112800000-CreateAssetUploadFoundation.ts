import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAssetUploadFoundation1788112800000 implements MigrationInterface {
  public readonly name = 'CreateAssetUploadFoundation1788112800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "assets" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "kind" varchar(16) NOT NULL,
        "status" varchar(24) NOT NULL,
        "original_file_name" varchar(255) NOT NULL,
        "declared_content_type" varchar(100) NOT NULL,
        "detected_content_type" varchar(100),
        "expected_size" bigint NOT NULL,
        "actual_size" bigint,
        "sha256" char(64) NOT NULL,
        "original_object_key" text NOT NULL,
        "original_etag" varchar(128),
        "version" integer NOT NULL DEFAULT 1,
        "created_by_admin_account_id" uuid NOT NULL,
        "uploaded_at" timestamptz,
        "failed_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_assets" PRIMARY KEY ("id"),
        CONSTRAINT "uq_assets_id_workspace" UNIQUE ("id", "workspace_id"),
        CONSTRAINT "uq_assets_original_object_key" UNIQUE ("original_object_key"),
        CONSTRAINT "fk_assets_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_assets_created_by"
          FOREIGN KEY ("created_by_admin_account_id")
          REFERENCES "admin_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_assets_kind" CHECK ("kind" IN ('image')),
        CONSTRAINT "chk_assets_status"
          CHECK ("status" IN ('uploading', 'uploaded', 'failed')),
        CONSTRAINT "chk_assets_declared_content_type"
          CHECK ("declared_content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
        CONSTRAINT "chk_assets_detected_content_type"
          CHECK (
            "detected_content_type" IS NULL
            OR "detected_content_type" IN ('image/jpeg', 'image/png', 'image/webp')
          ),
        CONSTRAINT "chk_assets_expected_size"
          CHECK ("expected_size" BETWEEN 1 AND 26214400),
        CONSTRAINT "chk_assets_actual_size"
          CHECK ("actual_size" IS NULL OR "actual_size" BETWEEN 1 AND 26214400),
        CONSTRAINT "chk_assets_sha256" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "chk_assets_version" CHECK ("version" >= 1),
        CONSTRAINT "chk_assets_status_time" CHECK (
          (
            "status" = 'uploading'
            AND "uploaded_at" IS NULL
            AND "failed_at" IS NULL
            AND "actual_size" IS NULL
            AND "detected_content_type" IS NULL
            AND "original_etag" IS NULL
          )
          OR (
            "status" = 'uploaded'
            AND "uploaded_at" IS NOT NULL
            AND "failed_at" IS NULL
            AND "actual_size" IS NOT NULL
            AND "detected_content_type" IS NOT NULL
            AND "original_etag" IS NOT NULL
          )
          OR (
            "status" = 'failed'
            AND "failed_at" IS NOT NULL
            AND "uploaded_at" IS NULL
          )
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_assets_workspace_created"
      ON "assets" ("workspace_id", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_assets_workspace_status_created"
      ON "assets" ("workspace_id", "status", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "asset_upload_sessions" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "asset_id" uuid NOT NULL,
        "status" varchar(24) NOT NULL,
        "temporary_object_key" text NOT NULL,
        "expected_size" bigint NOT NULL,
        "expected_sha256" char(64) NOT NULL,
        "declared_content_type" varchar(100) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "completed_at" timestamptz,
        "failed_at" timestamptz,
        "failure_code" varchar(80),
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_asset_upload_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "uq_asset_upload_sessions_id_workspace"
          UNIQUE ("id", "workspace_id"),
        CONSTRAINT "uq_asset_upload_sessions_temporary_object_key"
          UNIQUE ("temporary_object_key"),
        CONSTRAINT "fk_asset_upload_sessions_asset_workspace"
          FOREIGN KEY ("asset_id", "workspace_id")
          REFERENCES "assets" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "chk_asset_upload_sessions_status"
          CHECK ("status" IN ('pending', 'completed', 'failed')),
        CONSTRAINT "chk_asset_upload_sessions_expected_size"
          CHECK ("expected_size" BETWEEN 1 AND 26214400),
        CONSTRAINT "chk_asset_upload_sessions_expected_sha256"
          CHECK ("expected_sha256" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "chk_asset_upload_sessions_declared_content_type"
          CHECK ("declared_content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
        CONSTRAINT "chk_asset_upload_sessions_status_time" CHECK (
          (
            "status" = 'pending'
            AND "completed_at" IS NULL
            AND "failed_at" IS NULL
            AND "failure_code" IS NULL
          )
          OR (
            "status" = 'completed'
            AND "completed_at" IS NOT NULL
            AND "failed_at" IS NULL
            AND "failure_code" IS NULL
          )
          OR (
            "status" = 'failed'
            AND "completed_at" IS NULL
            AND "failed_at" IS NOT NULL
            AND "failure_code" IS NOT NULL
          )
        )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_asset_upload_sessions_pending_asset"
      ON "asset_upload_sessions" ("workspace_id", "asset_id")
      WHERE "status" = 'pending'
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_asset_upload_sessions_workspace_expires"
      ON "asset_upload_sessions" ("workspace_id", "status", "expires_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "asset_upload_sessions"');
    await queryRunner.query('DROP TABLE "assets"');
  }
}
