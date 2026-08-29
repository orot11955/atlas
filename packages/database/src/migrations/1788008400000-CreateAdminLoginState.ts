import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminLoginState1788008400000 implements MigrationInterface {
  public readonly name = 'CreateAdminLoginState1788008400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admin_login_attempts" (
        "id" uuid NOT NULL,
        "admin_account_id" uuid,
        "email_fingerprint" char(64) NOT NULL,
        "ip_fingerprint" char(64) NOT NULL,
        "outcome" varchar(32) NOT NULL,
        "request_id" varchar(128) NOT NULL,
        "occurred_at" timestamptz NOT NULL,
        CONSTRAINT "pk_admin_login_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "fk_admin_login_attempts_account" FOREIGN KEY ("admin_account_id")
          REFERENCES "admin_accounts" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_admin_login_attempts_email_fingerprint" CHECK (
          "email_fingerprint" ~ '^[0-9a-f]{64}$'
        ),
        CONSTRAINT "chk_admin_login_attempts_ip_fingerprint" CHECK (
          "ip_fingerprint" ~ '^[0-9a-f]{64}$'
        ),
        CONSTRAINT "chk_admin_login_attempts_outcome" CHECK (
          "outcome" IN (
            'invalid-credentials',
            'account-disabled',
            'account-locked',
            'password-verified'
          )
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_admin_login_attempts_account_occurred_at"
      ON "admin_login_attempts" ("admin_account_id", "occurred_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_admin_login_attempts_email_occurred_at"
      ON "admin_login_attempts" ("email_fingerprint", "occurred_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_admin_login_attempts_ip_occurred_at"
      ON "admin_login_attempts" ("ip_fingerprint", "occurred_at" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "admin_login_challenges" (
        "id" uuid NOT NULL,
        "admin_account_id" uuid NOT NULL,
        "token_digest" char(64) NOT NULL,
        "ip_fingerprint" char(64) NOT NULL,
        "request_id" varchar(128) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "consumed_at" timestamptz,
        "invalidated_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_admin_login_challenges" PRIMARY KEY ("id"),
        CONSTRAINT "uq_admin_login_challenges_token_digest" UNIQUE ("token_digest"),
        CONSTRAINT "fk_admin_login_challenges_account" FOREIGN KEY ("admin_account_id")
          REFERENCES "admin_accounts" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_admin_login_challenges_token_digest" CHECK (
          "token_digest" ~ '^[0-9a-f]{64}$'
        ),
        CONSTRAINT "chk_admin_login_challenges_ip_fingerprint" CHECK (
          "ip_fingerprint" ~ '^[0-9a-f]{64}$'
        ),
        CONSTRAINT "chk_admin_login_challenges_expiry" CHECK (
          "expires_at" > "created_at"
        ),
        CONSTRAINT "chk_admin_login_challenges_terminal_state" CHECK (
          NOT ("consumed_at" IS NOT NULL AND "invalidated_at" IS NOT NULL)
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_admin_login_challenges_account_expires_at"
      ON "admin_login_challenges" ("admin_account_id", "expires_at" DESC)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_admin_login_challenges_open_account"
      ON "admin_login_challenges" ("admin_account_id")
      WHERE "consumed_at" IS NULL AND "invalidated_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "admin_login_challenges"');
    await queryRunner.query('DROP TABLE "admin_login_attempts"');
  }
}
