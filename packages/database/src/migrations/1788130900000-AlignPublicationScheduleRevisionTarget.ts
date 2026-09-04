import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignPublicationScheduleRevisionTarget1788130900000 implements MigrationInterface {
  public readonly name = 'AlignPublicationScheduleRevisionTarget1788130900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "publication_schedules"
      ADD COLUMN "revision_id" uuid,
      ADD COLUMN "revision_number" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "publication_schedules"
      ADD CONSTRAINT "fk_publication_schedules_revision"
      FOREIGN KEY ("revision_id") REFERENCES "content_revisions" ("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "publication_schedules"
      ADD CONSTRAINT "chk_publication_schedules_revision_pair"
      CHECK (
        ("revision_id" IS NULL AND "revision_number" IS NULL)
        OR ("revision_id" IS NOT NULL AND "revision_number" >= 1)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "publication_schedules"
      DROP CONSTRAINT "chk_publication_schedules_revision_pair"
    `);
    await queryRunner.query(`
      ALTER TABLE "publication_schedules"
      DROP CONSTRAINT "fk_publication_schedules_revision"
    `);
    await queryRunner.query(`
      ALTER TABLE "publication_schedules"
      DROP COLUMN "revision_number",
      DROP COLUMN "revision_id"
    `);
  }
}
