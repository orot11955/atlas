import type { MigrationInterface, QueryRunner } from 'typeorm';

/** New writers must supply a target. Existing intent is never guessed or rewritten. */
export class CreatePublicationScheduleEffects1788664800000 implements MigrationInterface {
  public readonly name = 'CreatePublicationScheduleEffects1788664800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    this.requireTransaction(queryRunner);
    await queryRunner.query('LOCK TABLE publication_schedules IN ACCESS EXCLUSIVE MODE');
    await queryRunner.query(`
      ALTER TABLE publication_schedules ADD CONSTRAINT uq_publication_schedule_effect_scope
      UNIQUE (id, workspace_id, content_id, content_site_id, site_id)
    `);
    await queryRunner.query(`
      CREATE TABLE publication_schedule_effects (
        schedule_id uuid PRIMARY KEY,
        workspace_id uuid NOT NULL,
        content_id uuid NOT NULL,
        content_site_id uuid NOT NULL,
        site_id uuid NOT NULL,
        action varchar(16) NOT NULL,
        revision_id uuid,
        revision_number integer,
        target_publication_id uuid,
        publication_id uuid NOT NULL,
        outcome varchar(24) NOT NULL,
        recorded_at timestamptz NOT NULL,
        CONSTRAINT fk_publication_schedule_effect_scope
          FOREIGN KEY (schedule_id, workspace_id, content_id, content_site_id, site_id)
          REFERENCES publication_schedules (id, workspace_id, content_id, content_site_id, site_id)
          ON DELETE RESTRICT,
        CONSTRAINT fk_publication_schedule_effect_result
          FOREIGN KEY (publication_id, content_site_id, content_id, site_id, workspace_id)
          REFERENCES content_publications (id, content_site_id, content_id, site_id, workspace_id)
          ON DELETE RESTRICT,
        CONSTRAINT chk_publication_schedule_effect_target CHECK (
          (action = 'publish' AND revision_id IS NOT NULL AND revision_number IS NOT NULL
            AND revision_number > 0 AND target_publication_id IS NULL
            AND outcome IN ('published', 'already-published'))
          OR (action = 'withdraw' AND revision_id IS NULL AND revision_number IS NULL
            AND target_publication_id IS NOT NULL AND publication_id = target_publication_id
            AND outcome IN ('withdrawn', 'already-inactive'))
        )
      )
    `);
    await queryRunner.query(`
      CREATE FUNCTION require_new_publication_schedule_target() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (NEW.action = 'publish' AND NEW.revision_id IS NOT NULL
            AND NEW.revision_number IS NOT NULL AND NEW.revision_number > 0
            AND NEW.target_publication_id IS NULL)
           OR (NEW.action = 'withdraw' AND NEW.revision_id IS NULL AND NEW.revision_number IS NULL
            AND NEW.target_publication_id IS NOT NULL) THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'A new Publication schedule requires a pinned target'
          USING ERRCODE = '23514';
      END; $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_require_new_publication_schedule_target
      BEFORE INSERT ON publication_schedules FOR EACH ROW
      EXECUTE FUNCTION require_new_publication_schedule_target()
    `);
    await queryRunner.query(`
      CREATE FUNCTION guard_publication_schedule_effect() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE source publication_schedules%ROWTYPE; result content_publications%ROWTYPE;
      BEGIN
        IF TG_OP <> 'INSERT' THEN
          RAISE EXCEPTION 'Publication schedule effects are immutable' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO source FROM publication_schedules WHERE id = NEW.schedule_id FOR UPDATE;
        IF NOT FOUND OR source.status <> 'processing'
          OR source.workspace_id IS DISTINCT FROM NEW.workspace_id
          OR source.content_id IS DISTINCT FROM NEW.content_id
          OR source.content_site_id IS DISTINCT FROM NEW.content_site_id
          OR source.site_id IS DISTINCT FROM NEW.site_id
          OR source.action IS DISTINCT FROM NEW.action
          OR source.revision_id IS DISTINCT FROM NEW.revision_id
          OR source.revision_number IS DISTINCT FROM NEW.revision_number
          OR source.target_publication_id IS DISTINCT FROM NEW.target_publication_id THEN
          RAISE EXCEPTION 'Effect does not match the processing schedule target' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO result FROM content_publications WHERE id = NEW.publication_id;
        IF NOT FOUND OR (NEW.action = 'publish' AND (
            result.revision_id IS DISTINCT FROM NEW.revision_id
            OR result.revision_number IS DISTINCT FROM NEW.revision_number)) THEN
          RAISE EXCEPTION 'Effect Publication does not match its pinned Revision' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END; $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_guard_publication_schedule_effect
      BEFORE INSERT OR UPDATE OR DELETE ON publication_schedule_effects
      FOR EACH ROW EXECUTE FUNCTION guard_publication_schedule_effect()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    this.requireTransaction(queryRunner);
    await queryRunner.query('LOCK TABLE publication_schedules IN ACCESS EXCLUSIVE MODE');
    await queryRunner.query('LOCK TABLE publication_schedule_effects IN ACCESS EXCLUSIVE MODE');
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM publication_schedule_effects) THEN
        RAISE EXCEPTION 'Cannot drop durable Publication schedule effects' USING ERRCODE = '23514';
      END IF;
    END; $$`);
    await queryRunner.query('DROP TABLE publication_schedule_effects');
    await queryRunner.query('DROP FUNCTION guard_publication_schedule_effect()');
    await queryRunner.query('DROP TRIGGER trg_require_new_publication_schedule_target ON publication_schedules');
    await queryRunner.query('DROP FUNCTION require_new_publication_schedule_target()');
    await queryRunner.query('ALTER TABLE publication_schedules DROP CONSTRAINT uq_publication_schedule_effect_scope');
  }

  private requireTransaction(queryRunner: QueryRunner): void {
    if (!queryRunner.isTransactionActive) throw new Error('Schedule effects migration requires an active transaction.');
  }
}
