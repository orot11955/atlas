import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminTotpMfa1788013200000 implements MigrationInterface {
  public readonly name = 'CreateAdminTotpMfa1788013200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "admin_login_challenges"
      ADD COLUMN "mfa_failure_count" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "admin_login_challenges"
      ADD CONSTRAINT "chk_admin_login_challenges_mfa_failure_count"
      CHECK ("mfa_failure_count" >= 0)
    `);

    await queryRunner.query(`
      CREATE TABLE "admin_mfa_methods" (
        "id" uuid NOT NULL,
        "admin_account_id" uuid NOT NULL,
        "method_type" varchar(16) NOT NULL,
        "status" varchar(16) NOT NULL,
        "encrypted_secret" text NOT NULL,
        "secret_key_version" varchar(64) NOT NULL,
        "algorithm" varchar(16) NOT NULL,
        "digits" smallint NOT NULL,
        "period_seconds" smallint NOT NULL,
        "last_used_step" bigint,
        "enrolled_at" timestamptz NOT NULL,
        "activated_at" timestamptz,
        "disabled_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_admin_mfa_methods" PRIMARY KEY ("id"),
        CONSTRAINT "fk_admin_mfa_methods_account"
          FOREIGN KEY ("admin_account_id")
          REFERENCES "admin_accounts" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_admin_mfa_methods_account_type"
          UNIQUE ("admin_account_id", "method_type"),
        CONSTRAINT "chk_admin_mfa_methods_type"
          CHECK ("method_type" IN ('totp')),
        CONSTRAINT "chk_admin_mfa_methods_status"
          CHECK ("status" IN ('pending', 'active', 'disabled')),
        CONSTRAINT "chk_admin_mfa_methods_algorithm"
          CHECK ("algorithm" IN ('SHA1')),
        CONSTRAINT "chk_admin_mfa_methods_digits"
          CHECK ("digits" = 6),
        CONSTRAINT "chk_admin_mfa_methods_period"
          CHECK ("period_seconds" = 30),
        CONSTRAINT "chk_admin_mfa_methods_last_used_step"
          CHECK ("last_used_step" IS NULL OR "last_used_step" >= 0),
        CONSTRAINT "chk_admin_mfa_methods_lifecycle" CHECK (
          (
            "status" = 'pending'
            AND "activated_at" IS NULL
            AND "disabled_at" IS NULL
          )
          OR (
            "status" = 'active'
            AND "activated_at" IS NOT NULL
            AND "disabled_at" IS NULL
          )
          OR (
            "status" = 'disabled'
            AND "disabled_at" IS NOT NULL
          )
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_admin_mfa_methods_account_status"
      ON "admin_mfa_methods" ("admin_account_id", "status")
    `);

    await queryRunner.query(`
      CREATE TABLE "admin_recovery_codes" (
        "id" uuid NOT NULL,
        "admin_account_id" uuid NOT NULL,
        "code_digest" char(64) NOT NULL,
        "used_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_admin_recovery_codes" PRIMARY KEY ("id"),
        CONSTRAINT "fk_admin_recovery_codes_account"
          FOREIGN KEY ("admin_account_id")
          REFERENCES "admin_accounts" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_admin_recovery_codes_digest" UNIQUE ("code_digest"),
        CONSTRAINT "chk_admin_recovery_codes_digest"
          CHECK ("code_digest" ~ '^[0-9a-f]{64}$')
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_admin_recovery_codes_account_created_at"
      ON "admin_recovery_codes" ("admin_account_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_admin_recovery_codes_unused"
      ON "admin_recovery_codes" ("admin_account_id", "code_digest")
      WHERE "used_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "admin_authentication_grants" (
        "id" uuid NOT NULL,
        "admin_account_id" uuid NOT NULL,
        "source_challenge_id" uuid NOT NULL,
        "token_digest" char(64) NOT NULL,
        "ip_fingerprint" char(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "consumed_at" timestamptz,
        "invalidated_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_admin_authentication_grants" PRIMARY KEY ("id"),
        CONSTRAINT "fk_admin_authentication_grants_account"
          FOREIGN KEY ("admin_account_id")
          REFERENCES "admin_accounts" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_admin_authentication_grants_challenge"
          FOREIGN KEY ("source_challenge_id")
          REFERENCES "admin_login_challenges" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_admin_authentication_grants_token_digest"
          UNIQUE ("token_digest"),
        CONSTRAINT "uq_admin_authentication_grants_source_challenge"
          UNIQUE ("source_challenge_id"),
        CONSTRAINT "chk_admin_authentication_grants_token_digest"
          CHECK ("token_digest" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "chk_admin_authentication_grants_ip_fingerprint"
          CHECK ("ip_fingerprint" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "chk_admin_authentication_grants_expiry"
          CHECK ("expires_at" > "created_at"),
        CONSTRAINT "chk_admin_authentication_grants_terminal_state"
          CHECK (
            NOT (
              "consumed_at" IS NOT NULL
              AND "invalidated_at" IS NOT NULL
            )
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_admin_authentication_grants_account_expires_at"
      ON "admin_authentication_grants" ("admin_account_id", "expires_at" DESC)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_admin_authentication_grants_open_account"
      ON "admin_authentication_grants" ("admin_account_id")
      WHERE "consumed_at" IS NULL AND "invalidated_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "admin_authentication_grants"');
    await queryRunner.query('DROP TABLE "admin_recovery_codes"');
    await queryRunner.query('DROP TABLE "admin_mfa_methods"');
    await queryRunner.query(`
      ALTER TABLE "admin_login_challenges"
      DROP CONSTRAINT "chk_admin_login_challenges_mfa_failure_count"
    `);
    await queryRunner.query(`
      ALTER TABLE "admin_login_challenges"
      DROP COLUMN "mfa_failure_count"
    `);
  }
}
