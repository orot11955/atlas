import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateResourceMemberDirectory1788031200000 implements MigrationInterface {
  public readonly name = 'CreateResourceMemberDirectory1788031200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "resource_collections" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "parent_id" uuid,
        "name" varchar(120) NOT NULL,
        "normalized_name" varchar(120) NOT NULL,
        "description" varchar(500),
        "status" varchar(16) NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "archived_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_resource_collections" PRIMARY KEY ("id"),
        CONSTRAINT "uq_resource_collections_id_workspace" UNIQUE ("id", "workspace_id"),
        CONSTRAINT "fk_resource_collections_workspace" FOREIGN KEY ("workspace_id")
          REFERENCES "workspaces" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_resource_collections_parent" FOREIGN KEY ("parent_id", "workspace_id")
          REFERENCES "resource_collections" ("id", "workspace_id") ON DELETE RESTRICT,
        CONSTRAINT "chk_resource_collections_status" CHECK ("status" IN ('active', 'archived')),
        CONSTRAINT "chk_resource_collections_version" CHECK ("version" >= 1),
        CONSTRAINT "chk_resource_collections_archive" CHECK (
          ("status" = 'archived' AND "archived_at" IS NOT NULL)
          OR ("status" = 'active' AND "archived_at" IS NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_resource_collections_scope_name"
      ON "resource_collections" (
        "workspace_id",
        COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),
        "normalized_name"
      ) WHERE "status" = 'active'
    `);

    await queryRunner.query(`
      CREATE TABLE "resource_tags" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(64) NOT NULL,
        "normalized_name" varchar(64) NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_resource_tags" PRIMARY KEY ("id"),
        CONSTRAINT "uq_resource_tags_id_workspace" UNIQUE ("id", "workspace_id"),
        CONSTRAINT "uq_resource_tags_workspace_name" UNIQUE ("workspace_id", "normalized_name"),
        CONSTRAINT "fk_resource_tags_workspace" FOREIGN KEY ("workspace_id")
          REFERENCES "workspaces" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "resources" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "collection_id" uuid,
        "type" varchar(24) NOT NULL,
        "title" varchar(200) NOT NULL,
        "summary" varchar(1000),
        "body_markdown" text,
        "source_url" varchar(2000),
        "visibility" varchar(24) NOT NULL,
        "sensitivity" varchar(24) NOT NULL,
        "secret_reference" varchar(300),
        "status" varchar(16) NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "archived_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_resources" PRIMARY KEY ("id"),
        CONSTRAINT "uq_resources_id_workspace" UNIQUE ("id", "workspace_id"),
        CONSTRAINT "fk_resources_workspace" FOREIGN KEY ("workspace_id")
          REFERENCES "workspaces" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_resources_collection" FOREIGN KEY ("collection_id", "workspace_id")
          REFERENCES "resource_collections" ("id", "workspace_id") ON DELETE RESTRICT,
        CONSTRAINT "chk_resources_type" CHECK (
          "type" IN ('note', 'document', 'link', 'reference', 'checklist', 'snippet')
        ),
        CONSTRAINT "chk_resources_visibility" CHECK ("visibility" IN ('private', 'workspace')),
        CONSTRAINT "chk_resources_sensitivity" CHECK ("sensitivity" IN ('normal', 'sensitive')),
        CONSTRAINT "chk_resources_status" CHECK ("status" IN ('active', 'archived')),
        CONSTRAINT "chk_resources_version" CHECK ("version" >= 1),
        CONSTRAINT "chk_resources_archive" CHECK (
          ("status" = 'archived' AND "archived_at" IS NOT NULL)
          OR ("status" = 'active' AND "archived_at" IS NULL)
        ),
        CONSTRAINT "chk_resources_content" CHECK (
          ("type" = 'link' AND "source_url" IS NOT NULL)
          OR ("type" <> 'link' AND ("body_markdown" IS NOT NULL OR "source_url" IS NOT NULL))
        ),
        CONSTRAINT "chk_resources_secret_reference" CHECK (
          "secret_reference" IS NULL OR "secret_reference" LIKE 'secret://%'
        )
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_resources_workspace_status_updated" ON "resources" ("workspace_id", "status", "updated_at" DESC)`);
    await queryRunner.query(`CREATE INDEX "idx_resources_workspace_collection" ON "resources" ("workspace_id", "collection_id")`);

    await queryRunner.query(`
      CREATE TABLE "resource_tag_assignments" (
        "resource_id" uuid NOT NULL,
        "tag_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_resource_tag_assignments" PRIMARY KEY ("resource_id", "tag_id"),
        CONSTRAINT "fk_resource_tag_assignments_resource" FOREIGN KEY ("resource_id", "workspace_id")
          REFERENCES "resources" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "fk_resource_tag_assignments_tag" FOREIGN KEY ("tag_id", "workspace_id")
          REFERENCES "resource_tags" ("id", "workspace_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "resource_relations" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "resource_id" uuid NOT NULL,
        "target_type" varchar(24) NOT NULL,
        "target_id" uuid NOT NULL,
        "relation_type" varchar(32) NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_resource_relations" PRIMARY KEY ("id"),
        CONSTRAINT "uq_resource_relations" UNIQUE (
          "resource_id", "target_type", "target_id", "relation_type"
        ),
        CONSTRAINT "fk_resource_relations_resource" FOREIGN KEY ("resource_id", "workspace_id")
          REFERENCES "resources" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "chk_resource_relations_target_type" CHECK (
          "target_type" IN ('project', 'content', 'resource')
        ),
        CONSTRAINT "chk_resource_relations_type" CHECK (
          "relation_type" IN ('related-to', 'implements', 'references', 'derived-from')
        )
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_resource_relations_target" ON "resource_relations" ("workspace_id", "target_type", "target_id")`);

    await queryRunner.query(`
      CREATE TABLE "resource_assets" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "resource_id" uuid NOT NULL,
        "asset_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_resource_assets" PRIMARY KEY ("id"),
        CONSTRAINT "uq_resource_assets_resource_asset" UNIQUE ("resource_id", "asset_id"),
        CONSTRAINT "fk_resource_assets_resource" FOREIGN KEY ("resource_id", "workspace_id")
          REFERENCES "resources" ("id", "workspace_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "members" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "email" varchar(320),
        "normalized_email" varchar(320),
        "display_name" varchar(120) NOT NULL,
        "external_provider" varchar(64),
        "external_subject" varchar(240),
        "status" varchar(16) NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "archived_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_members" PRIMARY KEY ("id"),
        CONSTRAINT "uq_members_id_workspace" UNIQUE ("id", "workspace_id"),
        CONSTRAINT "fk_members_workspace" FOREIGN KEY ("workspace_id")
          REFERENCES "workspaces" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_members_identity" CHECK (
          "normalized_email" IS NOT NULL
          OR ("external_provider" IS NOT NULL AND "external_subject" IS NOT NULL)
        ),
        CONSTRAINT "chk_members_external_pair" CHECK (
          ("external_provider" IS NULL AND "external_subject" IS NULL)
          OR ("external_provider" IS NOT NULL AND "external_subject" IS NOT NULL)
        ),
        CONSTRAINT "chk_members_status" CHECK ("status" IN ('active', 'archived')),
        CONSTRAINT "chk_members_version" CHECK ("version" >= 1),
        CONSTRAINT "chk_members_archive" CHECK (
          ("status" = 'archived' AND "archived_at" IS NOT NULL)
          OR ("status" = 'active' AND "archived_at" IS NULL)
        )
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_members_workspace_email" ON "members" ("workspace_id", "normalized_email") WHERE "normalized_email" IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_members_workspace_external" ON "members" ("workspace_id", "external_provider", "external_subject") WHERE "external_provider" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX "idx_members_workspace_status_created" ON "members" ("workspace_id", "status", "created_at" DESC)`);

    await queryRunner.query(`
      CREATE TABLE "site_memberships" (
        "member_id" uuid NOT NULL,
        "site_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "status" varchar(24) NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "joined_at" timestamptz,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_site_memberships" PRIMARY KEY ("member_id", "site_id"),
        CONSTRAINT "fk_site_memberships_member" FOREIGN KEY ("member_id", "workspace_id")
          REFERENCES "members" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "fk_site_memberships_site" FOREIGN KEY ("site_id", "workspace_id")
          REFERENCES "sites" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "chk_site_memberships_status" CHECK (
          "status" IN ('pending', 'active', 'suspended', 'withdrawn')
        ),
        CONSTRAINT "chk_site_memberships_version" CHECK ("version" >= 1)
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_site_memberships_site_status" ON "site_memberships" ("site_id", "status")`);

    await queryRunner.query(`
      CREATE TABLE "member_admin_notes" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "member_id" uuid NOT NULL,
        "body" varchar(2000) NOT NULL,
        "created_by_admin_account_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_member_admin_notes" PRIMARY KEY ("id"),
        CONSTRAINT "fk_member_admin_notes_member" FOREIGN KEY ("member_id", "workspace_id")
          REFERENCES "members" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "fk_member_admin_notes_admin" FOREIGN KEY ("created_by_admin_account_id")
          REFERENCES "admin_accounts" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_member_admin_notes_member_created" ON "member_admin_notes" ("member_id", "created_at" DESC)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "member_admin_notes"');
    await queryRunner.query('DROP TABLE "site_memberships"');
    await queryRunner.query('DROP TABLE "members"');
    await queryRunner.query('DROP TABLE "resource_assets"');
    await queryRunner.query('DROP TABLE "resource_relations"');
    await queryRunner.query('DROP TABLE "resource_tag_assignments"');
    await queryRunner.query('DROP TABLE "resources"');
    await queryRunner.query('DROP TABLE "resource_tags"');
    await queryRunner.query('DROP TABLE "resource_collections"');
  }
}
