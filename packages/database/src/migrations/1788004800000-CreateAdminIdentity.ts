import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminIdentity1788004800000 implements MigrationInterface {
  public readonly name = 'CreateAdminIdentity1788004800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admin_accounts" (
        "id" uuid NOT NULL,
        "email" varchar(320) NOT NULL,
        "display_name" varchar(120) NOT NULL,
        "password_hash" text NOT NULL,
        "role" varchar(32) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'active',
        "failed_login_count" integer NOT NULL DEFAULT 0,
        "locked_until" timestamptz,
        "password_changed_at" timestamptz NOT NULL,
        "last_login_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_admin_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "uq_admin_accounts_email" UNIQUE ("email"),
        CONSTRAINT "chk_admin_accounts_email_canonical" CHECK (
          "email" = lower(btrim("email"))
        ),
        CONSTRAINT "chk_admin_accounts_display_name" CHECK (
          char_length(btrim("display_name")) BETWEEN 1 AND 120
        ),
        CONSTRAINT "chk_admin_accounts_password_hash" CHECK (
          "password_hash" LIKE '$argon2id$%'
        ),
        CONSTRAINT "chk_admin_accounts_role" CHECK (
          "role" IN ('owner', 'admin', 'editor', 'operator', 'viewer')
        ),
        CONSTRAINT "chk_admin_accounts_status" CHECK (
          "status" IN ('active', 'disabled')
        ),
        CONSTRAINT "chk_admin_accounts_failed_login_count" CHECK (
          "failed_login_count" >= 0
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_admin_accounts_role_status"
      ON "admin_accounts" ("role", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_admin_accounts_locked_until"
      ON "admin_accounts" ("locked_until")
      WHERE "locked_until" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "admin_accounts"');
  }
}
