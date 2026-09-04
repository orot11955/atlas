import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CompleteAssetMediaLifecycle1788127200000 implements MigrationInterface {
  public readonly name = 'CompleteAssetMediaLifecycle1788127200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "assets"
      ADD COLUMN "archived_at" timestamptz,
      ADD CONSTRAINT "chk_assets_archived_at"
        CHECK ("archived_at" IS NULL OR "status" IN ('ready', 'failed'))
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_assets_workspace_archived_created"
      ON "assets" ("workspace_id", "archived_at", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      ALTER TABLE "content_drafts"
      ADD COLUMN "cover_asset_id" uuid,
      ADD COLUMN "cover_alt_text" varchar(300),
      ADD COLUMN "cover_caption" varchar(1000),
      ADD CONSTRAINT "fk_content_drafts_cover_asset_workspace"
        FOREIGN KEY ("cover_asset_id", "workspace_id")
        REFERENCES "assets" ("id", "workspace_id") ON DELETE RESTRICT,
      ADD CONSTRAINT "chk_content_drafts_cover" CHECK (
        (
          "cover_asset_id" IS NULL
          AND "cover_alt_text" IS NULL
          AND "cover_caption" IS NULL
        )
        OR (
          "cover_asset_id" IS NOT NULL
          AND "cover_alt_text" IS NOT NULL
          AND char_length(btrim("cover_alt_text")) BETWEEN 1 AND 300
          AND ("cover_caption" IS NULL OR char_length("cover_caption") <= 1000)
        )
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "content_revisions"
      ADD COLUMN "cover_asset_id" uuid,
      ADD COLUMN "cover_alt_text" varchar(300),
      ADD COLUMN "cover_caption" varchar(1000),
      ADD CONSTRAINT "fk_content_revisions_cover_asset_workspace"
        FOREIGN KEY ("cover_asset_id", "workspace_id")
        REFERENCES "assets" ("id", "workspace_id") ON DELETE RESTRICT,
      ADD CONSTRAINT "chk_content_revisions_cover" CHECK (
        (
          "cover_asset_id" IS NULL
          AND "cover_alt_text" IS NULL
          AND "cover_caption" IS NULL
        )
        OR (
          "cover_asset_id" IS NOT NULL
          AND "cover_alt_text" IS NOT NULL
          AND char_length(btrim("cover_alt_text")) BETWEEN 1 AND 300
          AND ("cover_caption" IS NULL OR char_length("cover_caption") <= 1000)
        )
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "asset_usages"
      DROP CONSTRAINT "chk_asset_usages_ordinal",
      DROP CONSTRAINT "chk_asset_usages_kind",
      ADD CONSTRAINT "chk_asset_usages_kind"
        CHECK ("usage_kind" IN ('inline', 'cover')),
      ADD CONSTRAINT "chk_asset_usages_ordinal" CHECK (
        ("usage_kind" = 'cover' AND "ordinal" = 0)
        OR ("usage_kind" = 'inline' AND "ordinal" >= 1)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "asset_usages"
      DROP CONSTRAINT "chk_asset_usages_ordinal",
      DROP CONSTRAINT "chk_asset_usages_kind",
      ADD CONSTRAINT "chk_asset_usages_kind" CHECK ("usage_kind" IN ('inline')),
      ADD CONSTRAINT "chk_asset_usages_ordinal" CHECK ("ordinal" >= 1)
    `);

    await queryRunner.query(`
      ALTER TABLE "content_revisions"
      DROP CONSTRAINT "chk_content_revisions_cover",
      DROP CONSTRAINT "fk_content_revisions_cover_asset_workspace",
      DROP COLUMN "cover_caption",
      DROP COLUMN "cover_alt_text",
      DROP COLUMN "cover_asset_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "content_drafts"
      DROP CONSTRAINT "chk_content_drafts_cover",
      DROP CONSTRAINT "fk_content_drafts_cover_asset_workspace",
      DROP COLUMN "cover_caption",
      DROP COLUMN "cover_alt_text",
      DROP COLUMN "cover_asset_id"
    `);

    await queryRunner.query('DROP INDEX "idx_assets_workspace_archived_created"');
    await queryRunner.query(`
      ALTER TABLE "assets"
      DROP CONSTRAINT "chk_assets_archived_at",
      DROP COLUMN "archived_at"
    `);
  }
}
