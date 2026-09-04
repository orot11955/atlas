import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOutboxWebhookScheduling1788130800000 implements MigrationInterface {
  public readonly name = 'CreateOutboxWebhookScheduling1788130800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "outbox_events" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "site_id" uuid,
        "aggregate_type" varchar(80) NOT NULL,
        "aggregate_id" uuid NOT NULL,
        "event_type" varchar(120) NOT NULL,
        "schema_version" integer NOT NULL DEFAULT 1,
        "payload_json" jsonb NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "available_at" timestamptz NOT NULL,
        "claimed_at" timestamptz,
        "dispatched_at" timestamptz,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "last_error" varchar(1000),
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_outbox_events" PRIMARY KEY ("id"),
        CONSTRAINT "fk_outbox_events_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_outbox_events_site_workspace"
          FOREIGN KEY ("site_id", "workspace_id")
          REFERENCES "sites" ("id", "workspace_id") ON DELETE RESTRICT,
        CONSTRAINT "chk_outbox_events_aggregate_type"
          CHECK ("aggregate_type" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
        CONSTRAINT "chk_outbox_events_event_type"
          CHECK ("event_type" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
        CONSTRAINT "chk_outbox_events_schema_version" CHECK ("schema_version" >= 1),
        CONSTRAINT "chk_outbox_events_payload_object"
          CHECK (jsonb_typeof("payload_json") = 'object'),
        CONSTRAINT "chk_outbox_events_status"
          CHECK ("status" IN ('pending', 'processing', 'dispatched', 'dead')),
        CONSTRAINT "chk_outbox_events_attempt_count" CHECK ("attempt_count" >= 0),
        CONSTRAINT "chk_outbox_events_state" CHECK (
          ("status" = 'pending' AND "claimed_at" IS NULL AND "dispatched_at" IS NULL)
          OR ("status" = 'processing' AND "claimed_at" IS NOT NULL AND "dispatched_at" IS NULL)
          OR ("status" = 'dispatched' AND "claimed_at" IS NULL AND "dispatched_at" IS NOT NULL)
          OR ("status" = 'dead' AND "claimed_at" IS NULL AND "dispatched_at" IS NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_outbox_events_available"
      ON "outbox_events" ("status", "available_at", "created_at", "id")
      WHERE "status" IN ('pending', 'processing')
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_outbox_events_workspace_created"
      ON "outbox_events" ("workspace_id", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "event_consumptions" (
        "id" uuid NOT NULL,
        "consumer_key" varchar(120) NOT NULL,
        "event_id" uuid NOT NULL,
        "status" varchar(16) NOT NULL,
        "attempt_count" integer NOT NULL DEFAULT 1,
        "claimed_at" timestamptz NOT NULL,
        "processed_at" timestamptz,
        "result_json" jsonb,
        "last_error" varchar(1000),
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_event_consumptions" PRIMARY KEY ("id"),
        CONSTRAINT "uq_event_consumptions_consumer_event" UNIQUE ("consumer_key", "event_id"),
        CONSTRAINT "fk_event_consumptions_event"
          FOREIGN KEY ("event_id") REFERENCES "outbox_events" ("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_event_consumptions_key"
          CHECK ("consumer_key" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
        CONSTRAINT "chk_event_consumptions_status"
          CHECK ("status" IN ('processing', 'succeeded', 'failed')),
        CONSTRAINT "chk_event_consumptions_attempt_count" CHECK ("attempt_count" >= 1),
        CONSTRAINT "chk_event_consumptions_result_object"
          CHECK ("result_json" IS NULL OR jsonb_typeof("result_json") = 'object'),
        CONSTRAINT "chk_event_consumptions_state" CHECK (
          ("status" = 'processing' AND "processed_at" IS NULL)
          OR ("status" IN ('succeeded', 'failed') AND "processed_at" IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_event_consumptions_status_updated"
      ON "event_consumptions" ("status", "updated_at", "id")
    `);

    await queryRunner.query(`
      CREATE TABLE "webhook_endpoints" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "site_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "url" varchar(2048) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'active',
        "secret_ciphertext" text NOT NULL,
        "secret_key_version" varchar(64) NOT NULL,
        "subscribed_events" text[] NOT NULL,
        "consecutive_failure_count" integer NOT NULL DEFAULT 0,
        "disabled_at" timestamptz,
        "version" integer NOT NULL DEFAULT 1,
        "created_by_admin_account_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_webhook_endpoints" PRIMARY KEY ("id"),
        CONSTRAINT "uq_webhook_endpoints_site_url" UNIQUE ("workspace_id", "site_id", "url"),
        CONSTRAINT "fk_webhook_endpoints_site_workspace"
          FOREIGN KEY ("site_id", "workspace_id")
          REFERENCES "sites" ("id", "workspace_id") ON DELETE RESTRICT,
        CONSTRAINT "fk_webhook_endpoints_created_by"
          FOREIGN KEY ("created_by_admin_account_id")
          REFERENCES "admin_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_webhook_endpoints_name"
          CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
        CONSTRAINT "chk_webhook_endpoints_url"
          CHECK (char_length("url") BETWEEN 8 AND 2048),
        CONSTRAINT "chk_webhook_endpoints_status"
          CHECK ("status" IN ('active', 'disabled')),
        CONSTRAINT "chk_webhook_endpoints_events"
          CHECK (cardinality("subscribed_events") BETWEEN 1 AND 32),
        CONSTRAINT "chk_webhook_endpoints_failure_count"
          CHECK ("consecutive_failure_count" >= 0),
        CONSTRAINT "chk_webhook_endpoints_version" CHECK ("version" >= 1),
        CONSTRAINT "chk_webhook_endpoints_disabled_at" CHECK (
          ("status" = 'active' AND "disabled_at" IS NULL)
          OR ("status" = 'disabled' AND "disabled_at" IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_webhook_endpoints_site_status"
      ON "webhook_endpoints" ("workspace_id", "site_id", "status", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_webhook_endpoints_events"
      ON "webhook_endpoints" USING gin ("subscribed_events")
      WHERE "status" = 'active'
    `);

    await queryRunner.query(`
      CREATE TABLE "webhook_deliveries" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "endpoint_id" uuid NOT NULL,
        "event_id" uuid NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'pending',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "next_retry_at" timestamptz,
        "last_response_status" integer,
        "last_response_excerpt" varchar(2000),
        "last_error" varchar(1000),
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_webhook_deliveries" PRIMARY KEY ("id"),
        CONSTRAINT "uq_webhook_deliveries_endpoint_event" UNIQUE ("endpoint_id", "event_id"),
        CONSTRAINT "fk_webhook_deliveries_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_webhook_deliveries_endpoint"
          FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_webhook_deliveries_event"
          FOREIGN KEY ("event_id") REFERENCES "outbox_events" ("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_webhook_deliveries_status"
          CHECK ("status" IN ('pending', 'processing', 'retry_scheduled', 'succeeded', 'dead')),
        CONSTRAINT "chk_webhook_deliveries_attempt_count" CHECK ("attempt_count" >= 0),
        CONSTRAINT "chk_webhook_deliveries_response_status" CHECK (
          "last_response_status" IS NULL OR "last_response_status" BETWEEN 100 AND 599
        ),
        CONSTRAINT "chk_webhook_deliveries_retry_at" CHECK (
          ("status" = 'retry_scheduled' AND "next_retry_at" IS NOT NULL)
          OR ("status" <> 'retry_scheduled' AND "next_retry_at" IS NULL)
        ),
        CONSTRAINT "chk_webhook_deliveries_completed_at" CHECK (
          ("status" IN ('succeeded', 'dead') AND "completed_at" IS NOT NULL)
          OR ("status" NOT IN ('succeeded', 'dead') AND "completed_at" IS NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_webhook_deliveries_workspace_created"
      ON "webhook_deliveries" ("workspace_id", "created_at" DESC, "id" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_webhook_deliveries_endpoint_created"
      ON "webhook_deliveries" ("endpoint_id", "created_at" DESC, "id" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_webhook_deliveries_retry"
      ON "webhook_deliveries" ("status", "next_retry_at", "id")
      WHERE "status" = 'retry_scheduled'
    `);

    await queryRunner.query(`
      CREATE TABLE "webhook_delivery_attempts" (
        "id" uuid NOT NULL,
        "delivery_id" uuid NOT NULL,
        "attempt_number" integer NOT NULL,
        "status" varchar(16) NOT NULL,
        "request_body" text NOT NULL,
        "response_status" integer,
        "response_body_excerpt" varchar(2000),
        "error_message" varchar(1000),
        "requested_at" timestamptz NOT NULL,
        "completed_at" timestamptz,
        CONSTRAINT "pk_webhook_delivery_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "uq_webhook_delivery_attempts_number" UNIQUE ("delivery_id", "attempt_number"),
        CONSTRAINT "fk_webhook_delivery_attempts_delivery"
          FOREIGN KEY ("delivery_id") REFERENCES "webhook_deliveries" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_webhook_delivery_attempts_number" CHECK ("attempt_number" >= 1),
        CONSTRAINT "chk_webhook_delivery_attempts_status"
          CHECK ("status" IN ('processing', 'succeeded', 'failed')),
        CONSTRAINT "chk_webhook_delivery_attempts_response_status" CHECK (
          "response_status" IS NULL OR "response_status" BETWEEN 100 AND 599
        ),
        CONSTRAINT "chk_webhook_delivery_attempts_completed_at" CHECK (
          ("status" = 'processing' AND "completed_at" IS NULL)
          OR ("status" <> 'processing' AND "completed_at" IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_webhook_delivery_attempts_delivery"
      ON "webhook_delivery_attempts" ("delivery_id", "attempt_number" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "publication_schedules" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "site_id" uuid NOT NULL,
        "content_id" uuid NOT NULL,
        "content_site_id" uuid NOT NULL,
        "action" varchar(16) NOT NULL,
        "scheduled_for" timestamptz NOT NULL,
        "timezone" varchar(64) NOT NULL,
        "scheduled_local_at" varchar(32) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "next_attempt_at" timestamptz NOT NULL,
        "last_error" varchar(1000),
        "completed_at" timestamptz,
        "cancelled_at" timestamptz,
        "version" integer NOT NULL DEFAULT 1,
        "requested_by_admin_account_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_publication_schedules" PRIMARY KEY ("id"),
        CONSTRAINT "fk_publication_schedules_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_publication_schedules_site_workspace"
          FOREIGN KEY ("site_id", "workspace_id")
          REFERENCES "sites" ("id", "workspace_id") ON DELETE RESTRICT,
        CONSTRAINT "fk_publication_schedules_content"
          FOREIGN KEY ("content_id") REFERENCES "contents" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_publication_schedules_content_site"
          FOREIGN KEY ("content_site_id") REFERENCES "content_sites" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_publication_schedules_requested_by"
          FOREIGN KEY ("requested_by_admin_account_id")
          REFERENCES "admin_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_publication_schedules_action"
          CHECK ("action" IN ('publish', 'withdraw')),
        CONSTRAINT "chk_publication_schedules_status"
          CHECK ("status" IN ('pending', 'processing', 'completed', 'cancelled', 'failed')),
        CONSTRAINT "chk_publication_schedules_attempt_count" CHECK ("attempt_count" >= 0),
        CONSTRAINT "chk_publication_schedules_version" CHECK ("version" >= 1),
        CONSTRAINT "chk_publication_schedules_timezone"
          CHECK (char_length("timezone") BETWEEN 1 AND 64),
        CONSTRAINT "chk_publication_schedules_terminal_at" CHECK (
          ("status" = 'completed' AND "completed_at" IS NOT NULL AND "cancelled_at" IS NULL)
          OR ("status" = 'cancelled' AND "cancelled_at" IS NOT NULL AND "completed_at" IS NULL)
          OR ("status" = 'failed' AND "completed_at" IS NOT NULL AND "cancelled_at" IS NULL)
          OR ("status" IN ('pending', 'processing') AND "completed_at" IS NULL AND "cancelled_at" IS NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_publication_schedules_open"
      ON "publication_schedules" ("workspace_id", "content_site_id")
      WHERE "status" IN ('pending', 'processing')
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_publication_schedules_due"
      ON "publication_schedules" ("status", "next_attempt_at", "id")
      WHERE "status" IN ('pending', 'processing')
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_publication_schedules_content_site"
      ON "publication_schedules" ("workspace_id", "content_site_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE FUNCTION "atlas_guard_outbox_event_immutable"() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Outbox Events cannot be deleted';
        END IF;

        IF NEW."id" IS DISTINCT FROM OLD."id"
          OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
          OR NEW."site_id" IS DISTINCT FROM OLD."site_id"
          OR NEW."aggregate_type" IS DISTINCT FROM OLD."aggregate_type"
          OR NEW."aggregate_id" IS DISTINCT FROM OLD."aggregate_id"
          OR NEW."event_type" IS DISTINCT FROM OLD."event_type"
          OR NEW."schema_version" IS DISTINCT FROM OLD."schema_version"
          OR NEW."payload_json" IS DISTINCT FROM OLD."payload_json"
          OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
          RAISE EXCEPTION 'Outbox Event identity and payload are immutable';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_outbox_event_immutable"
      BEFORE UPDATE OR DELETE ON "outbox_events"
      FOR EACH ROW EXECUTE FUNCTION "atlas_guard_outbox_event_immutable"()
    `);

    await queryRunner.query(`
      CREATE FUNCTION "atlas_guard_webhook_attempt_immutable"() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Webhook Delivery Attempts cannot be deleted';
        END IF;

        IF NEW."id" IS DISTINCT FROM OLD."id"
          OR NEW."delivery_id" IS DISTINCT FROM OLD."delivery_id"
          OR NEW."attempt_number" IS DISTINCT FROM OLD."attempt_number"
          OR NEW."request_body" IS DISTINCT FROM OLD."request_body"
          OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at" THEN
          RAISE EXCEPTION 'Webhook Delivery Attempt request data is immutable';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_webhook_attempt_immutable"
      BEFORE UPDATE OR DELETE ON "webhook_delivery_attempts"
      FOR EACH ROW EXECUTE FUNCTION "atlas_guard_webhook_attempt_immutable"()
    `);

    await queryRunner.query(`
      CREATE FUNCTION "atlas_guard_publication_schedule_immutable"() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Publication Schedules cannot be deleted';
        END IF;

        IF NEW."id" IS DISTINCT FROM OLD."id"
          OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
          OR NEW."site_id" IS DISTINCT FROM OLD."site_id"
          OR NEW."content_id" IS DISTINCT FROM OLD."content_id"
          OR NEW."content_site_id" IS DISTINCT FROM OLD."content_site_id"
          OR NEW."action" IS DISTINCT FROM OLD."action"
          OR NEW."scheduled_for" IS DISTINCT FROM OLD."scheduled_for"
          OR NEW."timezone" IS DISTINCT FROM OLD."timezone"
          OR NEW."scheduled_local_at" IS DISTINCT FROM OLD."scheduled_local_at"
          OR NEW."requested_by_admin_account_id" IS DISTINCT FROM OLD."requested_by_admin_account_id"
          OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
          RAISE EXCEPTION 'Publication Schedule definition is immutable';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_publication_schedule_immutable"
      BEFORE UPDATE OR DELETE ON "publication_schedules"
      FOR EACH ROW EXECUTE FUNCTION "atlas_guard_publication_schedule_immutable"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "publication_schedules"');
    await queryRunner.query('DROP TABLE "webhook_delivery_attempts"');
    await queryRunner.query('DROP TABLE "webhook_deliveries"');
    await queryRunner.query('DROP TABLE "webhook_endpoints"');
    await queryRunner.query('DROP TABLE "event_consumptions"');
    await queryRunner.query('DROP TABLE "outbox_events"');
    await queryRunner.query('DROP FUNCTION "atlas_guard_publication_schedule_immutable"()');
    await queryRunner.query('DROP FUNCTION "atlas_guard_webhook_attempt_immutable"()');
    await queryRunner.query('DROP FUNCTION "atlas_guard_outbox_event_immutable"()');
  }
}
