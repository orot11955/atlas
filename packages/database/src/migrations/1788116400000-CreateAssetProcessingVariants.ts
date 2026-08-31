import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAssetProcessingVariants1788116400000 implements MigrationInterface {
  public readonly name = 'CreateAssetProcessingVariants1788116400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "assets" DROP CONSTRAINT "chk_assets_status_time"');
    await queryRunner.query('ALTER TABLE "assets" DROP CONSTRAINT "chk_assets_status"');

    await queryRunner.query(`
      ALTER TABLE "assets"
      ADD COLUMN "width" integer,
      ADD COLUMN "height" integer,
      ADD COLUMN "processing_failure_code" varchar(80),
      ADD COLUMN "processed_at" timestamptz
    `);

    await queryRunner.query(`
      ALTER TABLE "assets"
      ADD CONSTRAINT "chk_assets_status"
      CHECK ("status" IN ('uploading', 'uploaded', 'processing', 'ready', 'failed'))
    `);

    await queryRunner.query(`
      ALTER TABLE "assets"
      ADD CONSTRAINT "chk_assets_dimensions"
      CHECK (
        ("width" IS NULL AND "height" IS NULL)
        OR ("width" > 0 AND "height" > 0)
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "assets"
      ADD CONSTRAINT "chk_assets_processing_failure_code"
      CHECK (
        "processing_failure_code" IS NULL
        OR "processing_failure_code" ~ '^[a-z0-9._-]{1,80}$'
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "assets"
      ADD CONSTRAINT "chk_assets_status_time" CHECK (
        (
          "status" = 'uploading'
          AND "uploaded_at" IS NULL
          AND "processed_at" IS NULL
          AND "failed_at" IS NULL
          AND "actual_size" IS NULL
          AND "detected_content_type" IS NULL
          AND "original_etag" IS NULL
          AND "width" IS NULL
          AND "height" IS NULL
          AND "processing_failure_code" IS NULL
        )
        OR (
          "status" IN ('uploaded', 'processing')
          AND "uploaded_at" IS NOT NULL
          AND "processed_at" IS NULL
          AND "failed_at" IS NULL
          AND "actual_size" IS NOT NULL
          AND "detected_content_type" IS NOT NULL
          AND "original_etag" IS NOT NULL
          AND "width" IS NULL
          AND "height" IS NULL
          AND "processing_failure_code" IS NULL
        )
        OR (
          "status" = 'ready'
          AND "uploaded_at" IS NOT NULL
          AND "processed_at" IS NOT NULL
          AND "failed_at" IS NULL
          AND "actual_size" IS NOT NULL
          AND "detected_content_type" IS NOT NULL
          AND "original_etag" IS NOT NULL
          AND "width" IS NOT NULL
          AND "height" IS NOT NULL
          AND "processing_failure_code" IS NULL
        )
        OR (
          "status" = 'failed'
          AND "failed_at" IS NOT NULL
          AND "processed_at" IS NULL
          AND "width" IS NULL
          AND "height" IS NULL
          AND (
            (
              "uploaded_at" IS NULL
              AND "processing_failure_code" IS NULL
            )
            OR (
              "uploaded_at" IS NOT NULL
              AND "actual_size" IS NOT NULL
              AND "detected_content_type" IS NOT NULL
              AND "original_etag" IS NOT NULL
              AND "processing_failure_code" IS NOT NULL
            )
          )
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "asset_variants" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "asset_id" uuid NOT NULL,
        "variant_key" varchar(32) NOT NULL,
        "format" varchar(16) NOT NULL,
        "content_type" varchar(100) NOT NULL,
        "width" integer NOT NULL,
        "height" integer NOT NULL,
        "byte_size" bigint NOT NULL,
        "sha256" char(64) NOT NULL,
        "object_key" text NOT NULL,
        "etag" varchar(128) NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_asset_variants" PRIMARY KEY ("id"),
        CONSTRAINT "uq_asset_variants_asset_key"
          UNIQUE ("workspace_id", "asset_id", "variant_key"),
        CONSTRAINT "uq_asset_variants_object_key" UNIQUE ("object_key"),
        CONSTRAINT "fk_asset_variants_asset_workspace"
          FOREIGN KEY ("asset_id", "workspace_id")
          REFERENCES "assets" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "chk_asset_variants_key"
          CHECK ("variant_key" IN ('webp-320', 'webp-768', 'webp-1280', 'avif-1920')),
        CONSTRAINT "chk_asset_variants_format"
          CHECK ("format" IN ('webp', 'avif')),
        CONSTRAINT "chk_asset_variants_content_type"
          CHECK ("content_type" IN ('image/webp', 'image/avif')),
        CONSTRAINT "chk_asset_variants_format_content_type"
          CHECK (
            ("format" = 'webp' AND "content_type" = 'image/webp')
            OR ("format" = 'avif' AND "content_type" = 'image/avif')
          ),
        CONSTRAINT "chk_asset_variants_dimensions"
          CHECK ("width" > 0 AND "height" > 0),
        CONSTRAINT "chk_asset_variants_byte_size"
          CHECK ("byte_size" > 0 AND "byte_size" <= 26214400),
        CONSTRAINT "chk_asset_variants_sha256"
          CHECK ("sha256" ~ '^[0-9a-f]{64}$')
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_asset_variants_workspace_asset"
      ON "asset_variants" ("workspace_id", "asset_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "asset_processing_attempts" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "asset_id" uuid NOT NULL,
        "job_id" varchar(128) NOT NULL,
        "attempt_number" integer NOT NULL,
        "status" varchar(24) NOT NULL,
        "started_at" timestamptz NOT NULL,
        "completed_at" timestamptz,
        "failed_at" timestamptz,
        "failure_code" varchar(80),
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_asset_processing_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "uq_asset_processing_attempts_number"
          UNIQUE ("workspace_id", "asset_id", "attempt_number"),
        CONSTRAINT "fk_asset_processing_attempts_asset_workspace"
          FOREIGN KEY ("asset_id", "workspace_id")
          REFERENCES "assets" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "chk_asset_processing_attempts_number"
          CHECK ("attempt_number" >= 1),
        CONSTRAINT "chk_asset_processing_attempts_status"
          CHECK ("status" IN ('processing', 'succeeded', 'failed')),
        CONSTRAINT "chk_asset_processing_attempts_failure_code"
          CHECK (
            "failure_code" IS NULL
            OR "failure_code" ~ '^[a-z0-9._-]{1,80}$'
          ),
        CONSTRAINT "chk_asset_processing_attempts_status_time" CHECK (
          (
            "status" = 'processing'
            AND "completed_at" IS NULL
            AND "failed_at" IS NULL
            AND "failure_code" IS NULL
          )
          OR (
            "status" = 'succeeded'
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
      CREATE UNIQUE INDEX "uq_asset_processing_attempts_active_asset"
      ON "asset_processing_attempts" ("workspace_id", "asset_id")
      WHERE "status" = 'processing'
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_asset_processing_attempts_workspace_status"
      ON "asset_processing_attempts" ("workspace_id", "status", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_asset_processing_attempts_asset_attempt"
      ON "asset_processing_attempts" ("asset_id", "attempt_number" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "asset_processing_attempts"');
    await queryRunner.query('DROP TABLE "asset_variants"');

    await queryRunner.query('ALTER TABLE "assets" DROP CONSTRAINT "chk_assets_status_time"');
    await queryRunner.query(
      'ALTER TABLE "assets" DROP CONSTRAINT "chk_assets_processing_failure_code"',
    );
    await queryRunner.query('ALTER TABLE "assets" DROP CONSTRAINT "chk_assets_dimensions"');
    await queryRunner.query('ALTER TABLE "assets" DROP CONSTRAINT "chk_assets_status"');

    await queryRunner.query(`
      ALTER TABLE "assets"
      DROP COLUMN "processed_at",
      DROP COLUMN "processing_failure_code",
      DROP COLUMN "height",
      DROP COLUMN "width"
    `);

    await queryRunner.query(`
      ALTER TABLE "assets"
      ADD CONSTRAINT "chk_assets_status"
      CHECK ("status" IN ('uploading', 'uploaded', 'failed'))
    `);

    await queryRunner.query(`
      ALTER TABLE "assets"
      ADD CONSTRAINT "chk_assets_status_time" CHECK (
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
    `);
  }
}
