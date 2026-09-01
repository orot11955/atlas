import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAssetUsage1788120000000 implements MigrationInterface {
  public readonly name = 'CreateAssetUsage1788120000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "asset_usages" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "asset_id" uuid NOT NULL,
        "revision_id" uuid NOT NULL,
        "ordinal" integer NOT NULL,
        "usage_kind" varchar(24) NOT NULL,
        "alt_text" varchar(300) NOT NULL,
        "caption" varchar(1000),
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_asset_usages" PRIMARY KEY ("id"),
        CONSTRAINT "uq_asset_usages_id_workspace" UNIQUE ("id", "workspace_id"),
        CONSTRAINT "uq_asset_usages_revision_ordinal"
          UNIQUE ("workspace_id", "revision_id", "ordinal"),
        CONSTRAINT "fk_asset_usages_asset_workspace"
          FOREIGN KEY ("asset_id", "workspace_id")
          REFERENCES "assets" ("id", "workspace_id") ON DELETE RESTRICT,
        CONSTRAINT "fk_asset_usages_revision_workspace"
          FOREIGN KEY ("revision_id", "workspace_id")
          REFERENCES "content_revisions" ("id", "workspace_id") ON DELETE RESTRICT,
        CONSTRAINT "chk_asset_usages_ordinal" CHECK ("ordinal" >= 1),
        CONSTRAINT "chk_asset_usages_kind" CHECK ("usage_kind" IN ('inline')),
        CONSTRAINT "chk_asset_usages_alt_text" CHECK (char_length("alt_text") <= 300),
        CONSTRAINT "chk_asset_usages_caption"
          CHECK ("caption" IS NULL OR char_length("caption") <= 1000)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_asset_usages_workspace_asset"
      ON "asset_usages" ("workspace_id", "asset_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_asset_usages_workspace_revision"
      ON "asset_usages" ("workspace_id", "revision_id", "ordinal")
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "prevent_asset_usage_mutation"()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'asset usages are immutable';
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER "trg_asset_usages_immutable"
      BEFORE UPDATE OR DELETE ON "asset_usages"
      FOR EACH ROW EXECUTE FUNCTION "prevent_asset_usage_mutation"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "trg_asset_usages_immutable" ON "asset_usages"',
    );
    await queryRunner.query('DROP FUNCTION IF EXISTS "prevent_asset_usage_mutation"()');
    await queryRunner.query('DROP TABLE "asset_usages"');
  }
}
