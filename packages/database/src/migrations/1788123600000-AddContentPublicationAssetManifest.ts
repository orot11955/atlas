import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContentPublicationAssetManifest1788123600000 implements MigrationInterface {
  public readonly name = 'AddContentPublicationAssetManifest1788123600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "content_publications"
      ADD COLUMN "asset_manifest_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD CONSTRAINT "chk_content_publications_asset_manifest_array"
        CHECK (jsonb_typeof("asset_manifest_json") = 'array'),
      ADD CONSTRAINT "chk_content_publications_asset_manifest_size"
        CHECK (pg_column_size("asset_manifest_json") <= 1048576)
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_content_publications_asset_manifest"
      ON "content_publications" USING gin ("asset_manifest_json")
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
          NEW.asset_manifest_json,
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
          OLD.asset_manifest_json,
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "idx_content_publications_asset_manifest"');
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
      ALTER TABLE "content_publications"
      DROP CONSTRAINT "chk_content_publications_asset_manifest_size",
      DROP CONSTRAINT "chk_content_publications_asset_manifest_array",
      DROP COLUMN "asset_manifest_json"
    `);
  }
}
