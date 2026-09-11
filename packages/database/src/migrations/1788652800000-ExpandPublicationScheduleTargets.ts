import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Expand only. R03 must switch writers and workers before targets become required. */
export class ExpandPublicationScheduleTargets1788652800000 implements MigrationInterface {
  public readonly name = 'ExpandPublicationScheduleTargets1788652800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    this.requireTransaction(queryRunner);
    await queryRunner.query('LOCK TABLE "publication_schedules" IN ACCESS EXCLUSIVE MODE');
    // Never infer a historical intent from today's READY/ACTIVE pointers.
    await queryRunner.query(`
      DO $$
      DECLARE invalid_count bigint;
      BEGIN
        SELECT count(*) INTO invalid_count
        FROM "publication_schedules" s
        LEFT JOIN "content_sites" cs ON cs.id = s.content_site_id
        LEFT JOIN "content_revisions" r ON r.id = s.revision_id
        WHERE cs.workspace_id IS DISTINCT FROM s.workspace_id
           OR cs.content_id IS DISTINCT FROM s.content_id
           OR cs.site_id IS DISTINCT FROM s.site_id
           OR (s.revision_id IS NULL) <> (s.revision_number IS NULL)
           OR (s.revision_id IS NOT NULL AND (
             r.workspace_id IS DISTINCT FROM s.workspace_id
             OR r.content_id IS DISTINCT FROM s.content_id
             OR r.revision_number IS DISTINCT FROM s.revision_number
             OR s.action <> 'publish'
           ));
        IF invalid_count > 0 THEN
          RAISE EXCEPTION 'R02 preflight: % invalid schedule target/scope rows; no data changed',
            invalid_count USING ERRCODE = '23514';
        END IF;
      END;
      $$
    `);
    await queryRunner.query(`
      ALTER TABLE "content_revisions"
      ADD CONSTRAINT "uq_content_revisions_schedule_target"
      UNIQUE ("id", "content_id", "workspace_id", "revision_number")
    `);
    await queryRunner.query(`
      ALTER TABLE "content_sites"
      ADD CONSTRAINT "uq_content_sites_schedule_scope"
      UNIQUE ("id", "content_id", "site_id", "workspace_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "content_publications"
      ADD CONSTRAINT "uq_content_publications_schedule_target"
      UNIQUE ("id", "content_site_id", "content_id", "site_id", "workspace_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "publication_schedules"
      ADD COLUMN "target_publication_id" uuid,
      DROP CONSTRAINT "chk_publication_schedules_revision_pair",
      ADD CONSTRAINT "chk_publication_schedules_revision_pair" CHECK (
        ("revision_id" IS NULL AND "revision_number" IS NULL)
        OR ("revision_id" IS NOT NULL AND "revision_number" IS NOT NULL
          AND "revision_number" >= 1)
      ),
      ADD CONSTRAINT "chk_publication_schedules_target_action" CHECK (
        ("revision_id" IS NULL OR "action" = 'publish')
        AND ("target_publication_id" IS NULL OR "action" = 'withdraw')
      ),
      ADD CONSTRAINT "fk_publication_schedules_content_workspace"
        FOREIGN KEY ("content_id", "workspace_id")
        REFERENCES "contents" ("id", "workspace_id") ON DELETE RESTRICT,
      ADD CONSTRAINT "fk_publication_schedules_content_site_scope"
        FOREIGN KEY ("content_site_id", "content_id", "site_id", "workspace_id")
        REFERENCES "content_sites" ("id", "content_id", "site_id", "workspace_id")
        ON DELETE RESTRICT,
      ADD CONSTRAINT "fk_publication_schedules_revision_target"
        FOREIGN KEY ("revision_id", "content_id", "workspace_id", "revision_number")
        REFERENCES "content_revisions" ("id", "content_id", "workspace_id", "revision_number")
        ON DELETE RESTRICT,
      ADD CONSTRAINT "fk_publication_schedules_publication_target"
        FOREIGN KEY ("target_publication_id", "content_site_id", "content_id", "site_id", "workspace_id")
        REFERENCES "content_publications" ("id", "content_site_id", "content_id", "site_id", "workspace_id")
        ON DELETE RESTRICT
    `);
    // A separate trigger keeps the original definition/delete guard intact.
    await queryRunner.query(`
      CREATE FUNCTION "atlas_guard_publication_schedule_targets"() RETURNS trigger AS $$
      BEGIN
        IF ROW(NEW.revision_id, NEW.revision_number, NEW.target_publication_id)
           IS DISTINCT FROM ROW(OLD.revision_id, OLD.revision_number, OLD.target_publication_id) THEN
          RAISE EXCEPTION 'Publication Schedule targets are immutable' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_publication_schedule_targets"
      BEFORE UPDATE ON "publication_schedules"
      FOR EACH ROW EXECUTE FUNCTION "atlas_guard_publication_schedule_targets"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    this.requireTransaction(queryRunner);
    await queryRunner.query('LOCK TABLE "publication_schedules" IN ACCESS EXCLUSIVE MODE');
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "publication_schedules" WHERE "target_publication_id" IS NOT NULL) THEN
          RAISE EXCEPTION 'R02 rollback refused: persisted publication targets would be lost'
            USING ERRCODE = '23514';
        END IF;
      END;
      $$
    `);
    await queryRunner.query(`
      DROP TRIGGER "trg_publication_schedule_targets" ON "publication_schedules"
    `);
    await queryRunner.query('DROP FUNCTION "atlas_guard_publication_schedule_targets"()');
    await queryRunner.query(`
      ALTER TABLE "publication_schedules"
      DROP CONSTRAINT "fk_publication_schedules_publication_target",
      DROP CONSTRAINT "fk_publication_schedules_revision_target",
      DROP CONSTRAINT "fk_publication_schedules_content_site_scope",
      DROP CONSTRAINT "fk_publication_schedules_content_workspace",
      DROP CONSTRAINT "chk_publication_schedules_target_action",
      DROP CONSTRAINT "chk_publication_schedules_revision_pair",
      ADD CONSTRAINT "chk_publication_schedules_revision_pair" CHECK (
        ("revision_id" IS NULL AND "revision_number" IS NULL)
        OR ("revision_id" IS NOT NULL AND "revision_number" >= 1)
      ),
      DROP COLUMN "target_publication_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "content_publications" DROP CONSTRAINT "uq_content_publications_schedule_target"
    `);
    await queryRunner.query(`
      ALTER TABLE "content_sites" DROP CONSTRAINT "uq_content_sites_schedule_scope"
    `);
    await queryRunner.query(`
      ALTER TABLE "content_revisions" DROP CONSTRAINT "uq_content_revisions_schedule_target"
    `);
  }

  private requireTransaction(queryRunner: QueryRunner): void {
    if (!queryRunner.isTransactionActive) {
      throw new Error('R02 requires a transaction; use TypeORM transaction mode all or each.');
    }
  }
}
