import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjectDeploymentReadModel1788027600000 implements MigrationInterface {
  public readonly name = 'CreateProjectDeploymentReadModel1788027600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "projects" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "key" varchar(64) NOT NULL,
        "name" varchar(120) NOT NULL,
        "description" varchar(1000),
        "status" varchar(24) NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "archived_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_projects" PRIMARY KEY ("id"),
        CONSTRAINT "uq_projects_id_workspace" UNIQUE ("id", "workspace_id"),
        CONSTRAINT "uq_projects_workspace_key" UNIQUE ("workspace_id", "key"),
        CONSTRAINT "fk_projects_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_projects_key"
          CHECK ("key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
        CONSTRAINT "chk_projects_name"
          CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
        CONSTRAINT "chk_projects_status"
          CHECK ("status" IN ('active', 'paused', 'archived')),
        CONSTRAINT "chk_projects_version" CHECK ("version" >= 1),
        CONSTRAINT "chk_projects_archived_at" CHECK (
          ("status" = 'archived' AND "archived_at" IS NOT NULL)
          OR ("status" <> 'archived' AND "archived_at" IS NULL)
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_projects_workspace_status_created"
      ON "projects" ("workspace_id", "status", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "project_sites" (
        "project_id" uuid NOT NULL,
        "site_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_project_sites" PRIMARY KEY ("project_id", "site_id"),
        CONSTRAINT "fk_project_sites_project_workspace"
          FOREIGN KEY ("project_id", "workspace_id")
          REFERENCES "projects" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "fk_project_sites_site_workspace"
          FOREIGN KEY ("site_id", "workspace_id")
          REFERENCES "sites" ("id", "workspace_id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_project_sites_workspace_site"
      ON "project_sites" ("workspace_id", "site_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "project_events" (
        "id" uuid NOT NULL,
        "project_id" uuid NOT NULL,
        "type" varchar(120) NOT NULL,
        "message" varchar(2000),
        "metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "occurred_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_project_events" PRIMARY KEY ("id"),
        CONSTRAINT "fk_project_events_project"
          FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_project_events_metadata"
          CHECK (jsonb_typeof("metadata_json") = 'object')
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_project_events_project_occurred"
      ON "project_events" ("project_id", "occurred_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "repository_connections" (
        "id" uuid NOT NULL,
        "project_id" uuid NOT NULL,
        "provider" varchar(24) NOT NULL,
        "repository_url" varchar(500) NOT NULL,
        "repository_full_name" varchar(240),
        "default_branch" varchar(240) NOT NULL,
        "external_id" varchar(240),
        "status" varchar(24) NOT NULL,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_repository_connections" PRIMARY KEY ("id"),
        CONSTRAINT "uq_repository_connections_project_url"
          UNIQUE ("project_id", "repository_url"),
        CONSTRAINT "fk_repository_connections_project"
          FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_repository_connections_provider"
          CHECK ("provider" IN ('gitea', 'github', 'gitlab', 'other')),
        CONSTRAINT "chk_repository_connections_status"
          CHECK ("status" IN ('active', 'disabled'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_repository_connections_project_status"
      ON "repository_connections" ("project_id", "status")
    `);

    await queryRunner.query(`
      CREATE TABLE "releases" (
        "id" uuid NOT NULL,
        "project_id" uuid NOT NULL,
        "version" varchar(120) NOT NULL,
        "commit_sha" varchar(64) NOT NULL,
        "source_ref" varchar(240),
        "external_id" varchar(240),
        "metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_releases" PRIMARY KEY ("id"),
        CONSTRAINT "uq_releases_project_version" UNIQUE ("project_id", "version"),
        CONSTRAINT "fk_releases_project"
          FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_releases_commit_sha"
          CHECK ("commit_sha" ~ '^[0-9a-f]{7,64}$'),
        CONSTRAINT "chk_releases_metadata"
          CHECK (jsonb_typeof("metadata_json") = 'object')
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_releases_project_external_id"
      ON "releases" ("project_id", "external_id")
      WHERE "external_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_releases_project_created"
      ON "releases" ("project_id", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "environments" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "key" varchar(64) NOT NULL,
        "name" varchar(120) NOT NULL,
        "tier" varchar(24) NOT NULL,
        "status" varchar(24) NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_environments" PRIMARY KEY ("id"),
        CONSTRAINT "uq_environments_id_workspace" UNIQUE ("id", "workspace_id"),
        CONSTRAINT "uq_environments_workspace_key" UNIQUE ("workspace_id", "key"),
        CONSTRAINT "fk_environments_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_environments_key"
          CHECK ("key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
        CONSTRAINT "chk_environments_tier"
          CHECK ("tier" IN ('development', 'staging', 'production', 'other')),
        CONSTRAINT "chk_environments_status"
          CHECK ("status" IN ('active', 'disabled')),
        CONSTRAINT "chk_environments_version" CHECK ("version" >= 1)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_environments_workspace_status"
      ON "environments" ("workspace_id", "status", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "services" (
        "id" uuid NOT NULL,
        "project_id" uuid NOT NULL,
        "key" varchar(64) NOT NULL,
        "name" varchar(120) NOT NULL,
        "type" varchar(24) NOT NULL,
        "status" varchar(24) NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "archived_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_services" PRIMARY KEY ("id"),
        CONSTRAINT "uq_services_id_project" UNIQUE ("id", "project_id"),
        CONSTRAINT "uq_services_project_key" UNIQUE ("project_id", "key"),
        CONSTRAINT "fk_services_project"
          FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_services_key"
          CHECK ("key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
        CONSTRAINT "chk_services_type"
          CHECK ("type" IN ('web', 'api', 'worker', 'database', 'other')),
        CONSTRAINT "chk_services_status"
          CHECK ("status" IN ('active', 'disabled', 'archived')),
        CONSTRAINT "chk_services_version" CHECK ("version" >= 1),
        CONSTRAINT "chk_services_archived_at" CHECK (
          ("status" = 'archived' AND "archived_at" IS NOT NULL)
          OR ("status" <> 'archived' AND "archived_at" IS NULL)
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_services_project_status"
      ON "services" ("project_id", "status", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "service_environments" (
        "id" uuid NOT NULL,
        "service_id" uuid NOT NULL,
        "environment_id" uuid NOT NULL,
        "health_url" varchar(500),
        "health_timeout_ms" integer NOT NULL DEFAULT 5000,
        "current_release_id" uuid,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_service_environments" PRIMARY KEY ("id"),
        CONSTRAINT "uq_service_environments_service_environment"
          UNIQUE ("service_id", "environment_id"),
        CONSTRAINT "fk_service_environments_service"
          FOREIGN KEY ("service_id") REFERENCES "services" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_service_environments_environment"
          FOREIGN KEY ("environment_id") REFERENCES "environments" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_service_environments_current_release"
          FOREIGN KEY ("current_release_id") REFERENCES "releases" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_service_environments_timeout"
          CHECK ("health_timeout_ms" BETWEEN 500 AND 60000),
        CONSTRAINT "chk_service_environments_version" CHECK ("version" >= 1)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_service_environments_environment"
      ON "service_environments" ("environment_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "deployments" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "project_id" uuid NOT NULL,
        "service_environment_id" uuid NOT NULL,
        "release_id" uuid NOT NULL,
        "external_id" varchar(240),
        "status" varchar(24) NOT NULL,
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "failure_code" varchar(120),
        "failure_message" varchar(2000),
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_deployments" PRIMARY KEY ("id"),
        CONSTRAINT "fk_deployments_project_workspace"
          FOREIGN KEY ("project_id", "workspace_id")
          REFERENCES "projects" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "fk_deployments_service_environment"
          FOREIGN KEY ("service_environment_id")
          REFERENCES "service_environments" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_deployments_release"
          FOREIGN KEY ("release_id") REFERENCES "releases" ("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_deployments_status"
          CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
        CONSTRAINT "chk_deployments_terminal_time" CHECK (
          ("status" IN ('succeeded', 'failed', 'cancelled') AND "completed_at" IS NOT NULL)
          OR ("status" IN ('queued', 'running') AND "completed_at" IS NULL)
        ),
        CONSTRAINT "chk_deployments_failure" CHECK (
          ("status" = 'failed')
          OR ("failure_code" IS NULL AND "failure_message" IS NULL)
        )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_deployments_project_external_id"
      ON "deployments" ("project_id", "external_id")
      WHERE "external_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_deployments_workspace_created"
      ON "deployments" ("workspace_id", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_deployments_project_status_created"
      ON "deployments" ("project_id", "status", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_deployments_service_environment_created"
      ON "deployments" ("service_environment_id", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "deployment_events" (
        "id" uuid NOT NULL,
        "deployment_id" uuid NOT NULL,
        "external_event_id" varchar(240),
        "type" varchar(120) NOT NULL,
        "status" varchar(24),
        "message" varchar(2000),
        "metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "occurred_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_deployment_events" PRIMARY KEY ("id"),
        CONSTRAINT "fk_deployment_events_deployment"
          FOREIGN KEY ("deployment_id") REFERENCES "deployments" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_deployment_events_status" CHECK (
          "status" IS NULL
          OR "status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
        ),
        CONSTRAINT "chk_deployment_events_metadata"
          CHECK (jsonb_typeof("metadata_json") = 'object')
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_deployment_events_external_id"
      ON "deployment_events" ("deployment_id", "external_event_id")
      WHERE "external_event_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_deployment_events_deployment_occurred"
      ON "deployment_events" ("deployment_id", "occurred_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "health_checks" (
        "id" uuid NOT NULL,
        "service_environment_id" uuid NOT NULL,
        "deployment_id" uuid,
        "status" varchar(24) NOT NULL,
        "http_status" integer,
        "latency_ms" integer,
        "message" varchar(2000),
        "checked_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_health_checks" PRIMARY KEY ("id"),
        CONSTRAINT "fk_health_checks_service_environment"
          FOREIGN KEY ("service_environment_id")
          REFERENCES "service_environments" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_health_checks_deployment"
          FOREIGN KEY ("deployment_id") REFERENCES "deployments" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_health_checks_status"
          CHECK ("status" IN ('healthy', 'unhealthy', 'unknown')),
        CONSTRAINT "chk_health_checks_http_status"
          CHECK ("http_status" IS NULL OR "http_status" BETWEEN 100 AND 599),
        CONSTRAINT "chk_health_checks_latency"
          CHECK ("latency_ms" IS NULL OR "latency_ms" BETWEEN 0 AND 3600000)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_health_checks_service_environment_checked"
      ON "health_checks" ("service_environment_id", "checked_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_health_checks_deployment_checked"
      ON "health_checks" ("deployment_id", "checked_at" DESC, "id" DESC)
      WHERE "deployment_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "idempotency_records" (
        "api_client_id" uuid NOT NULL,
        "operation" varchar(120) NOT NULL,
        "key" varchar(200) NOT NULL,
        "request_hash" char(64) NOT NULL,
        "resource_id" uuid,
        "response_status" integer NOT NULL,
        "response_json" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_idempotency_records"
          PRIMARY KEY ("api_client_id", "operation", "key"),
        CONSTRAINT "fk_idempotency_records_api_client"
          FOREIGN KEY ("api_client_id") REFERENCES "api_clients" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_idempotency_records_request_hash"
          CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "chk_idempotency_records_response_json"
          CHECK (jsonb_typeof("response_json") = 'object'),
        CONSTRAINT "chk_idempotency_records_response_status"
          CHECK ("response_status" BETWEEN 100 AND 599)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "idempotency_records"');
    await queryRunner.query('DROP TABLE "health_checks"');
    await queryRunner.query('DROP TABLE "deployment_events"');
    await queryRunner.query('DROP TABLE "deployments"');
    await queryRunner.query('DROP TABLE "service_environments"');
    await queryRunner.query('DROP TABLE "services"');
    await queryRunner.query('DROP TABLE "environments"');
    await queryRunner.query('DROP TABLE "releases"');
    await queryRunner.query('DROP TABLE "repository_connections"');
    await queryRunner.query('DROP TABLE "project_events"');
    await queryRunner.query('DROP TABLE "project_sites"');
    await queryRunner.query('DROP TABLE "projects"');
  }
}
