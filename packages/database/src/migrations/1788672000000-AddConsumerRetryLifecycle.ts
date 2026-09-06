import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConsumerRetryLifecycle1788672000000 implements MigrationInterface {
  public readonly name = 'AddConsumerRetryLifecycle1788672000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE event_consumptions
      DROP CONSTRAINT chk_event_consumptions_status,
      DROP CONSTRAINT chk_event_consumptions_state,
      DROP CONSTRAINT chk_event_consumptions_attempt_count,
      ADD COLUMN attempt_limit integer NOT NULL DEFAULT 5,
      ADD COLUMN cycle_start_attempt integer NOT NULL DEFAULT 0,
      ADD COLUMN next_attempt_at timestamptz,
      ADD COLUMN notify_after timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z',
      ADD COLUMN notification_version integer NOT NULL DEFAULT 0,
      ADD COLUMN failure_code varchar(64)`);
    // Do not invent historical attempts or replay unclassified failures on rollout.
    // Existing success rows and payloads retain all their pre-migration values.
    await q.query(`UPDATE event_consumptions SET attempt_limit = GREATEST(5, attempt_count)
      WHERE attempt_count > 5`);
    await q.query(`UPDATE event_consumptions SET status = 'dead', failure_code = 'legacy-unclassified'
      WHERE status = 'failed'`);
    await q.query(`ALTER TABLE event_consumptions
      ADD CONSTRAINT chk_event_consumptions_status CHECK (status IN ('pending','processing','failed','dead','succeeded')),
      ADD CONSTRAINT chk_event_consumptions_attempt_count CHECK (attempt_count >= 0),
      ADD CONSTRAINT chk_consumer_retry_budget CHECK (
        cycle_start_attempt >= 0 AND attempt_count >= cycle_start_attempt AND
        attempt_limit > cycle_start_attempt AND attempt_limit >= attempt_count AND notification_version >= 0),
      ADD CONSTRAINT chk_event_consumptions_state CHECK (
        (status = 'pending' AND processed_at IS NULL AND next_attempt_at IS NOT NULL) OR
        (status = 'processing' AND attempt_count > cycle_start_attempt AND processed_at IS NULL AND next_attempt_at IS NULL) OR
        (status = 'failed' AND processed_at IS NOT NULL AND next_attempt_at IS NOT NULL AND attempt_count < attempt_limit) OR
        (status IN ('dead','succeeded') AND processed_at IS NOT NULL AND next_attempt_at IS NULL))`);
    await q.query(`CREATE INDEX idx_consumer_notification_due ON event_consumptions
      (consumer_key, notify_after, next_attempt_at, id) WHERE status IN ('pending','failed','processing')`);
    await q.query(`CREATE TABLE event_consumption_attempts (
      consumption_id uuid NOT NULL REFERENCES event_consumptions(id) ON DELETE RESTRICT,
      attempt_number integer NOT NULL CHECK (attempt_number >= 1),
      cycle_start_attempt integer NOT NULL CHECK (cycle_start_attempt >= 0 AND cycle_start_attempt < attempt_number),
      outcome varchar(16) NOT NULL CHECK (outcome IN ('succeeded','failed','dead','abandoned')),
      failure_code varchar(64), started_at timestamptz NOT NULL, finished_at timestamptz NOT NULL,
      PRIMARY KEY (consumption_id, attempt_number))`);
    await q.query(`CREATE TABLE event_consumption_replays (
      id uuid PRIMARY KEY,
      consumption_id uuid NOT NULL REFERENCES event_consumptions(id) ON DELETE RESTRICT,
      requested_by_admin_account_id uuid NOT NULL REFERENCES admin_accounts(id) ON DELETE RESTRICT,
      previous_attempt integer NOT NULL CHECK (previous_attempt >= 1),
      previous_limit integer NOT NULL, next_limit integer NOT NULL,
      reason varchar(32) NOT NULL CHECK (reason IN ('dependency-restored','handler-upgraded','operator-reviewed')),
      created_at timestamptz NOT NULL,
      CHECK (previous_limit >= previous_attempt AND next_limit = previous_attempt + 5))`);
    await q.query(`CREATE INDEX idx_consumer_replays_history ON event_consumption_replays (consumption_id, created_at DESC, id)`);
    await q.query(`CREATE FUNCTION guard_consumer_history() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Consumer attempt/replay history is immutable' USING ERRCODE='23514'; END; $$`);
    for (const table of ['event_consumption_attempts', 'event_consumption_replays']) {
      await q.query(`CREATE TRIGGER trg_${table}_immutable BEFORE UPDATE OR DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION guard_consumer_history()`);
    }
    await q.query(`CREATE FUNCTION guard_consumer_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.event_id IS DISTINCT FROM OLD.event_id OR
           NEW.consumer_key IS DISTINCT FROM OLD.consumer_key OR
           NEW.attempt_count < OLD.attempt_count OR NEW.notification_version < OLD.notification_version THEN
          RAISE EXCEPTION 'Consumer identity and counters cannot regress' USING ERRCODE='23514';
        END IF;
        IF OLD.status = 'succeeded' AND NEW IS DISTINCT FROM OLD THEN
          RAISE EXCEPTION 'Succeeded Consumer receipt is immutable' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END; $$`);
    await q.query(`CREATE TRIGGER trg_consumer_lifecycle BEFORE UPDATE ON event_consumptions
      FOR EACH ROW EXECUTE FUNCTION guard_consumer_lifecycle()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Refuse loss of any post-migration execution/replay evidence or retry semantics.
    await q.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM event_consumption_attempts) OR
         EXISTS (SELECT 1 FROM event_consumption_replays) OR
         EXISTS (SELECT 1 FROM event_consumptions WHERE status IN ('pending','dead','failed')
           OR notification_version > 0 OR cycle_start_attempt > 0) THEN
        RAISE EXCEPTION 'Consumer retry state/history prevents destructive rollback' USING ERRCODE='23514';
      END IF;
    END; $$`);
    await q.query('DROP TRIGGER trg_consumer_lifecycle ON event_consumptions');
    await q.query('DROP FUNCTION guard_consumer_lifecycle()');
    await q.query('DROP TABLE event_consumption_replays, event_consumption_attempts');
    await q.query('DROP FUNCTION guard_consumer_history()');
    await q.query('DROP INDEX idx_consumer_notification_due');
    await q.query(`ALTER TABLE event_consumptions
      DROP CONSTRAINT chk_event_consumptions_status, DROP CONSTRAINT chk_event_consumptions_state,
      DROP CONSTRAINT chk_event_consumptions_attempt_count, DROP CONSTRAINT chk_consumer_retry_budget,
      DROP COLUMN attempt_limit, DROP COLUMN cycle_start_attempt, DROP COLUMN next_attempt_at,
      DROP COLUMN notify_after, DROP COLUMN notification_version, DROP COLUMN failure_code,
      ADD CONSTRAINT chk_event_consumptions_status CHECK (status IN ('processing','succeeded','failed')),
      ADD CONSTRAINT chk_event_consumptions_attempt_count CHECK (attempt_count >= 1),
      ADD CONSTRAINT chk_event_consumptions_state CHECK ((status='processing' AND processed_at IS NULL)
        OR (status IN ('succeeded','failed') AND processed_at IS NOT NULL))`);
  }
}
