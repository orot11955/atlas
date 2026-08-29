import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminSessions1788016800000 implements MigrationInterface {
  public readonly name = 'CreateAdminSessions1788016800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admin_sessions" (
        "id" uuid NOT NULL,
        "admin_account_id" uuid NOT NULL,
        "source_grant_id" uuid NOT NULL,
        "token_digest" char(64) NOT NULL,
        "csrf_token_digest" char(64) NOT NULL,
        "client_fingerprint" char(64) NOT NULL,
        "role" varchar(32) NOT NULL,
        "password_changed_at" timestamptz NOT NULL,
        "user_agent_summary" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL,
        "last_seen_at" timestamptz NOT NULL,
        "idle_expires_at" timestamptz NOT NULL,
        "absolute_expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz,
        "revoke_reason" varchar(48),
        CONSTRAINT "pk_admin_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "fk_admin_sessions_account"
          FOREIGN KEY ("admin_account_id")
          REFERENCES "admin_accounts" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_admin_sessions_source_grant"
          FOREIGN KEY ("source_grant_id")
          REFERENCES "admin_authentication_grants" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_admin_sessions_source_grant" UNIQUE ("source_grant_id"),
        CONSTRAINT "uq_admin_sessions_token_digest" UNIQUE ("token_digest"),
        CONSTRAINT "uq_admin_sessions_csrf_token_digest" UNIQUE ("csrf_token_digest"),
        CONSTRAINT "chk_admin_sessions_token_digest"
          CHECK ("token_digest" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "chk_admin_sessions_csrf_token_digest"
          CHECK ("csrf_token_digest" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "chk_admin_sessions_client_fingerprint"
          CHECK ("client_fingerprint" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "chk_admin_sessions_role"
          CHECK ("role" IN ('owner', 'admin', 'editor', 'operator', 'viewer')),
        CONSTRAINT "chk_admin_sessions_user_agent_summary"
          CHECK (char_length(btrim("user_agent_summary")) BETWEEN 1 AND 255),
        CONSTRAINT "chk_admin_sessions_lifecycle" CHECK (
          "last_seen_at" >= "created_at"
          AND "idle_expires_at" > "last_seen_at"
          AND "absolute_expires_at" > "created_at"
          AND "idle_expires_at" <= "absolute_expires_at"
        ),
        CONSTRAINT "chk_admin_sessions_revocation" CHECK (
          ("revoked_at" IS NULL AND "revoke_reason" IS NULL)
          OR ("revoked_at" IS NOT NULL AND "revoke_reason" IS NOT NULL)
        ),
        CONSTRAINT "chk_admin_sessions_revoke_reason" CHECK (
          "revoke_reason" IS NULL
          OR "revoke_reason" IN (
            'account-changed',
            'expired',
            'logout',
            'max-active-sessions',
            'other-session-revoked',
            'revoked-by-admin'
          )
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_admin_sessions_account_created_at"
      ON "admin_sessions" ("admin_account_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_admin_sessions_account_active"
      ON "admin_sessions" (
        "admin_account_id",
        "revoked_at",
        "idle_expires_at",
        "absolute_expires_at"
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "admin_sessions"');
  }
}
