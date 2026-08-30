from __future__ import annotations

import re
from pathlib import Path
from textwrap import dedent

ROOT = Path.cwd()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(dedent(content).lstrip(), encoding="utf-8")


def add_unique_to_module(path: str, import_line: str, section: str, symbol: str) -> None:
    target = ROOT / path
    value = target.read_text(encoding="utf-8")
    if import_line not in value:
        imports = list(re.finditer(r"(?m)^import .+;$", value))
        if not imports:
            raise RuntimeError(f"No import block found in {path}")
        point = imports[-1].end()
        value = value[:point] + "\n" + import_line + value[point:]
    pattern = re.compile(rf"({section}\s*:\s*\[)(?P<body>[\s\S]*?)(\])")
    match = pattern.search(value)
    if not match:
        raise RuntimeError(f"{section} array not found in {path}")
    body = match.group("body")
    if re.search(rf"\b{re.escape(symbol)}\b", body) is None:
        indentation = "    "
        existing = re.search(r"(?m)^(\s*)\w", body)
        if existing:
            indentation = existing.group(1)
        body = body.rstrip() + f"\n{indentation}{symbol},\n  "
        value = value[: match.start("body")] + body + value[match.end("body") :]
    target.write_text(value, encoding="utf-8")


write(
    "packages/database/src/migrations/1788076200000-CreateContentPublicationDelivery.ts",
    r'''
    import type { MigrationInterface, QueryRunner } from 'typeorm';

    export class CreateContentPublicationDelivery1788076200000 implements MigrationInterface {
      public readonly name = 'CreateContentPublicationDelivery1788076200000';

      public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
          CREATE TABLE "content_sites" (
            "id" uuid NOT NULL,
            "workspace_id" uuid NOT NULL,
            "content_id" uuid NOT NULL,
            "site_id" uuid NOT NULL,
            "slug" varchar(160) NOT NULL,
            "title_override" varchar(240),
            "summary_override" varchar(1000),
            "seo_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
            "visibility" varchar(16) NOT NULL DEFAULT 'public',
            "version" integer NOT NULL DEFAULT 1,
            "created_at" timestamptz NOT NULL,
            "updated_at" timestamptz NOT NULL,
            CONSTRAINT "pk_content_sites" PRIMARY KEY ("id"),
            CONSTRAINT "uq_content_sites_content_site" UNIQUE ("content_id", "site_id"),
            CONSTRAINT "uq_content_sites_site_slug" UNIQUE ("site_id", "slug"),
            CONSTRAINT "fk_content_sites_workspace"
              FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE,
            CONSTRAINT "fk_content_sites_content"
              FOREIGN KEY ("content_id") REFERENCES "contents" ("id") ON DELETE CASCADE,
            CONSTRAINT "fk_content_sites_site"
              FOREIGN KEY ("site_id") REFERENCES "sites" ("id") ON DELETE CASCADE,
            CONSTRAINT "chk_content_sites_slug"
              CHECK ("slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
            CONSTRAINT "chk_content_sites_visibility"
              CHECK ("visibility" IN ('public', 'unlisted', 'private')),
            CONSTRAINT "chk_content_sites_version" CHECK ("version" >= 1),
            CONSTRAINT "chk_content_sites_seo_object"
              CHECK (jsonb_typeof("seo_json") = 'object')
          )
        `);

        await queryRunner.query(`
          CREATE INDEX "idx_content_sites_workspace_site"
          ON "content_sites" ("workspace_id", "site_id", "updated_at" DESC)
        `);

        await queryRunner.query(`
          CREATE TABLE "content_publications" (
            "id" uuid NOT NULL,
            "workspace_id" uuid NOT NULL,
            "content_site_id" uuid NOT NULL,
            "content_id" uuid NOT NULL,
            "site_id" uuid NOT NULL,
            "revision_id" uuid NOT NULL,
            "revision_number" integer NOT NULL,
            "status" varchar(16) NOT NULL,
            "slug" varchar(160) NOT NULL,
            "title" varchar(240) NOT NULL,
            "summary" varchar(1000),
            "body_html" text NOT NULL,
            "seo_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
            "visibility" varchar(16) NOT NULL,
            "etag" char(64) NOT NULL,
            "published_at" timestamptz NOT NULL,
            "superseded_at" timestamptz,
            "withdrawn_at" timestamptz,
            "created_by_admin_account_id" uuid,
            "created_at" timestamptz NOT NULL,
            CONSTRAINT "pk_content_publications" PRIMARY KEY ("id"),
            CONSTRAINT "fk_content_publications_workspace"
              FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE,
            CONSTRAINT "fk_content_publications_content_site"
              FOREIGN KEY ("content_site_id") REFERENCES "content_sites" ("id") ON DELETE CASCADE,
            CONSTRAINT "fk_content_publications_content"
              FOREIGN KEY ("content_id") REFERENCES "contents" ("id") ON DELETE CASCADE,
            CONSTRAINT "fk_content_publications_site"
              FOREIGN KEY ("site_id") REFERENCES "sites" ("id") ON DELETE CASCADE,
            CONSTRAINT "fk_content_publications_revision"
              FOREIGN KEY ("revision_id") REFERENCES "content_revisions" ("id") ON DELETE RESTRICT,
            CONSTRAINT "fk_content_publications_admin"
              FOREIGN KEY ("created_by_admin_account_id") REFERENCES "admin_accounts" ("id") ON DELETE SET NULL,
            CONSTRAINT "chk_content_publications_status"
              CHECK ("status" IN ('active', 'superseded', 'withdrawn', 'failed')),
            CONSTRAINT "chk_content_publications_visibility"
              CHECK ("visibility" IN ('public', 'unlisted', 'private')),
            CONSTRAINT "chk_content_publications_revision_number" CHECK ("revision_number" >= 1),
            CONSTRAINT "chk_content_publications_etag"
              CHECK ("etag" ~ '^[0-9a-f]{64}$'),
            CONSTRAINT "chk_content_publications_seo_object"
              CHECK (jsonb_typeof("seo_json") = 'object'),
            CONSTRAINT "chk_content_publications_status_time" CHECK (
              ("status" = 'active' AND "superseded_at" IS NULL AND "withdrawn_at" IS NULL)
              OR ("status" = 'superseded' AND "superseded_at" IS NOT NULL AND "withdrawn_at" IS NULL)
              OR ("status" = 'withdrawn' AND "withdrawn_at" IS NOT NULL)
              OR ("status" = 'failed')
            )
          )
        `);

        await queryRunner.query(`
          CREATE UNIQUE INDEX "uq_content_publications_active"
          ON "content_publications" ("content_site_id")
          WHERE "status" = 'active'
        `);

        await queryRunner.query(`
          CREATE INDEX "idx_content_publications_delivery"
          ON "content_publications" ("site_id", "status", "visibility", "published_at" DESC, "id" DESC)
        `);

        await queryRunner.query(`
          CREATE INDEX "idx_content_publications_history"
          ON "content_publications" ("content_site_id", "published_at" DESC, "id" DESC)
        `);
      }

      public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE "content_publications"');
        await queryRunner.query('DROP TABLE "content_sites"');
      }
    }
    ''',
)

write(
    "apps/api/src/content/content-publication.service.ts",
    r'''
    import { createHash, randomUUID } from 'node:crypto';

    import {
      BadRequestException,
      ConflictException,
      Injectable,
      NotFoundException,
    } from '@nestjs/common';
    import type { EntityManager } from 'typeorm';
    import { DataSource } from 'typeorm';

    export type ContentSiteVisibility = 'public' | 'unlisted' | 'private';
    export type PublicationStatus = 'active' | 'superseded' | 'withdrawn' | 'failed';

    export interface ContentSiteInput {
      siteId: string;
      slug: string;
      titleOverride?: string;
      summaryOverride?: string;
      seo?: Record<string, unknown>;
      visibility?: ContentSiteVisibility;
    }

    export interface UpdateContentSiteInput {
      version: number;
      slug: string;
      titleOverride?: string;
      summaryOverride?: string;
      seo?: Record<string, unknown>;
      visibility: ContentSiteVisibility;
    }

    @Injectable()
    export class ContentPublicationService {
      public constructor(private readonly dataSource: DataSource) {}

      public async listContentSites(workspaceId: string, contentId: string) {
        await this.requireContent(workspaceId, contentId);
        const rows = (await this.dataSource.query(
          `SELECT
             cs.*,
             s.key AS site_key,
             s.name AS site_name,
             p.id AS active_publication_id,
             p.revision_number AS active_revision_number,
             p.published_at AS active_published_at,
             p.etag AS active_etag
           FROM content_sites cs
           JOIN sites s ON s.id = cs.site_id AND s.workspace_id = cs.workspace_id
           LEFT JOIN LATERAL (
             SELECT id, revision_number, published_at, etag
             FROM content_publications
             WHERE content_site_id = cs.id AND status = 'active'
             ORDER BY published_at DESC, id DESC
             LIMIT 1
           ) p ON true
           WHERE cs.workspace_id = $1 AND cs.content_id = $2
           ORDER BY cs.created_at ASC, cs.id ASC`,
          [workspaceId, contentId],
        )) as ContentSiteRow[];
        return rows.map(toContentSite);
      }

      public async createContentSite(
        workspaceId: string,
        contentId: string,
        input: ContentSiteInput,
      ) {
        await this.requireContent(workspaceId, contentId);
        await this.requireSite(workspaceId, input.siteId);
        const now = new Date();
        const id = randomUUID();
        try {
          const rows = (await this.dataSource.query(
            `INSERT INTO content_sites (
               id, workspace_id, content_id, site_id, slug,
               title_override, summary_override, seo_json, visibility,
               version, created_at, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,1,$10,$10)
             RETURNING *`,
            [
              id,
              workspaceId,
              contentId,
              input.siteId,
              normalizeSlug(input.slug),
              normalizeOptional(input.titleOverride),
              normalizeOptional(input.summaryOverride),
              JSON.stringify(input.seo ?? {}),
              input.visibility ?? 'public',
              now,
            ],
          )) as ContentSiteRow[];
          return toContentSite(rows[0]);
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ConflictException({
              code: 'CONTENT_SITE_CONFLICT',
              detail: 'The Content is already assigned to this Site or the Slug is already in use.',
            });
          }
          throw error;
        }
      }

      public async updateContentSite(
        workspaceId: string,
        contentId: string,
        contentSiteId: string,
        input: UpdateContentSiteInput,
      ) {
        try {
          const rows = (await this.dataSource.query(
            `UPDATE content_sites
             SET slug = $1,
                 title_override = $2,
                 summary_override = $3,
                 seo_json = $4::jsonb,
                 visibility = $5,
                 version = version + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $6 AND workspace_id = $7 AND content_id = $8 AND version = $9
             RETURNING *`,
            [
              normalizeSlug(input.slug),
              normalizeOptional(input.titleOverride),
              normalizeOptional(input.summaryOverride),
              JSON.stringify(input.seo ?? {}),
              input.visibility,
              contentSiteId,
              workspaceId,
              contentId,
              input.version,
            ],
          )) as ContentSiteRow[];
          if (!rows[0]) {
            const exists = await this.findContentSite(workspaceId, contentId, contentSiteId);
            if (!exists) {
              throw new NotFoundException({
                code: 'CONTENT_SITE_NOT_FOUND',
                detail: 'Content Site assignment was not found.',
              });
            }
            throw new ConflictException({
              code: 'CONTENT_SITE_VERSION_CONFLICT',
              detail: 'Content Site assignment was modified by another request.',
            });
          }
          return toContentSite(rows[0]);
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ConflictException({
              code: 'CONTENT_SITE_SLUG_CONFLICT',
              detail: 'The Slug is already used by another Content on this Site.',
            });
          }
          throw error;
        }
      }

      public async publish(
        workspaceId: string,
        contentId: string,
        contentSiteId: string,
        actorId?: string,
      ) {
        return this.dataSource.transaction(async (manager) => {
          const site = await this.lockContentSite(manager, workspaceId, contentId, contentSiteId);
          const revisionRows = (await manager.query(
            `SELECT
               c.status AS content_status,
               c.ready_revision_number,
               r.id AS revision_id,
               r.revision_number,
               r.title,
               r.excerpt,
               r.body_html
             FROM contents c
             LEFT JOIN content_revisions r
               ON r.content_id = c.id
              AND r.revision_number = c.ready_revision_number
              AND r.kind = 'ready'
             WHERE c.id = $1 AND c.workspace_id = $2
             FOR UPDATE OF c`,
            [contentId, workspaceId],
          )) as ReadyRevisionRow[];
          const revision = revisionRows[0];
          if (!revision || revision.content_status === 'archived') {
            throw new ConflictException({
              code: 'CONTENT_NOT_PUBLISHABLE',
              detail: 'Archived or missing Content cannot be published.',
            });
          }
          if (!revision.revision_id || !revision.ready_revision_number) {
            throw new ConflictException({
              code: 'CONTENT_READY_REVISION_REQUIRED',
              detail: 'Only the current READY Revision can be published.',
            });
          }

          const now = new Date();
          await manager.query(
            `UPDATE content_publications
             SET status = 'superseded', superseded_at = $1
             WHERE content_site_id = $2 AND status = 'active'`,
            [now, contentSiteId],
          );

          const snapshot = {
            slug: site.slug,
            title: site.title_override ?? revision.title,
            summary: site.summary_override ?? revision.excerpt ?? undefined,
            bodyHtml: revision.body_html,
            seo: site.seo_json ?? {},
            visibility: site.visibility,
            revisionId: revision.revision_id,
            revisionNumber: revision.revision_number,
          };
          const etag = hashSnapshot(snapshot);
          const publicationId = randomUUID();
          const rows = (await manager.query(
            `INSERT INTO content_publications (
               id, workspace_id, content_site_id, content_id, site_id,
               revision_id, revision_number, status, slug, title, summary,
               body_html, seo_json, visibility, etag, published_at,
               created_by_admin_account_id, created_at
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$15
             ) RETURNING *`,
            [
              publicationId,
              workspaceId,
              contentSiteId,
              contentId,
              site.site_id,
              revision.revision_id,
              revision.revision_number,
              snapshot.slug,
              snapshot.title,
              snapshot.summary ?? null,
              snapshot.bodyHtml,
              JSON.stringify(snapshot.seo),
              snapshot.visibility,
              etag,
              now,
              actorId ?? null,
            ],
          )) as PublicationRow[];
          return toPublication(rows[0]);
        });
      }

      public async withdraw(workspaceId: string, contentId: string, contentSiteId: string) {
        const rows = (await this.dataSource.query(
          `UPDATE content_publications p
           SET status = 'withdrawn', withdrawn_at = CURRENT_TIMESTAMP
           FROM content_sites cs
           WHERE p.content_site_id = cs.id
             AND p.status = 'active'
             AND cs.id = $1
             AND cs.workspace_id = $2
             AND cs.content_id = $3
           RETURNING p.*`,
          [contentSiteId, workspaceId, contentId],
        )) as PublicationRow[];
        if (!rows[0]) {
          throw new ConflictException({
            code: 'ACTIVE_PUBLICATION_NOT_FOUND',
            detail: 'There is no active Publication to withdraw.',
          });
        }
        return toPublication(rows[0]);
      }

      public async listPublications(workspaceId: string, contentId: string, contentSiteId: string) {
        const assignment = await this.findContentSite(workspaceId, contentId, contentSiteId);
        if (!assignment) {
          throw new NotFoundException({
            code: 'CONTENT_SITE_NOT_FOUND',
            detail: 'Content Site assignment was not found.',
          });
        }
        const rows = (await this.dataSource.query(
          `SELECT * FROM content_publications
           WHERE workspace_id = $1 AND content_site_id = $2
           ORDER BY published_at DESC, id DESC`,
          [workspaceId, contentSiteId],
        )) as PublicationRow[];
        return rows.map(toPublication);
      }

      public async rollback(
        workspaceId: string,
        contentId: string,
        contentSiteId: string,
        publicationId: string,
        actorId?: string,
      ) {
        return this.dataSource.transaction(async (manager) => {
          const assignment = await this.lockContentSite(
            manager,
            workspaceId,
            contentId,
            contentSiteId,
          );
          const targets = (await manager.query(
            `SELECT * FROM content_publications
             WHERE id = $1 AND workspace_id = $2 AND content_site_id = $3
             LIMIT 1`,
            [publicationId, workspaceId, contentSiteId],
          )) as PublicationRow[];
          const target = targets[0];
          if (!target) {
            throw new NotFoundException({
              code: 'PUBLICATION_NOT_FOUND',
              detail: 'Publication history entry was not found.',
            });
          }
          const now = new Date();
          await manager.query(
            `UPDATE content_publications
             SET status = 'superseded', superseded_at = $1
             WHERE content_site_id = $2 AND status = 'active'`,
            [now, contentSiteId],
          );
          const rows = (await manager.query(
            `INSERT INTO content_publications (
               id, workspace_id, content_site_id, content_id, site_id,
               revision_id, revision_number, status, slug, title, summary,
               body_html, seo_json, visibility, etag, published_at,
               created_by_admin_account_id, created_at
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$15
             ) RETURNING *`,
            [
              randomUUID(),
              workspaceId,
              contentSiteId,
              contentId,
              assignment.site_id,
              target.revision_id,
              target.revision_number,
              target.slug,
              target.title,
              target.summary,
              target.body_html,
              JSON.stringify(target.seo_json ?? {}),
              target.visibility,
              target.etag,
              now,
              actorId ?? null,
            ],
          )) as PublicationRow[];
          return toPublication(rows[0]);
        });
      }

      private async requireContent(workspaceId: string, contentId: string) {
        const rows = (await this.dataSource.query(
          `SELECT id, status FROM contents WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
          [contentId, workspaceId],
        )) as Array<{ id: string; status: string }>;
        if (!rows[0]) {
          throw new NotFoundException({ code: 'CONTENT_NOT_FOUND', detail: 'Content was not found.' });
        }
        if (rows[0].status === 'archived') {
          throw new ConflictException({
            code: 'CONTENT_ARCHIVED',
            detail: 'Archived Content cannot be assigned or published.',
          });
        }
        return rows[0];
      }

      private async requireSite(workspaceId: string, siteId: string) {
        const rows = (await this.dataSource.query(
          `SELECT id FROM sites
           WHERE id = $1 AND workspace_id = $2 AND status <> 'archived'
           LIMIT 1`,
          [siteId, workspaceId],
        )) as Array<{ id: string }>;
        if (!rows[0]) {
          throw new NotFoundException({ code: 'SITE_NOT_FOUND', detail: 'Site was not found.' });
        }
      }

      private async findContentSite(workspaceId: string, contentId: string, id: string) {
        const rows = (await this.dataSource.query(
          `SELECT * FROM content_sites
           WHERE id = $1 AND workspace_id = $2 AND content_id = $3 LIMIT 1`,
          [id, workspaceId, contentId],
        )) as ContentSiteRow[];
        return rows[0];
      }

      private async lockContentSite(
        manager: EntityManager,
        workspaceId: string,
        contentId: string,
        id: string,
      ) {
        const rows = (await manager.query(
          `SELECT * FROM content_sites
           WHERE id = $1 AND workspace_id = $2 AND content_id = $3
           FOR UPDATE`,
          [id, workspaceId, contentId],
        )) as ContentSiteRow[];
        if (!rows[0]) {
          throw new NotFoundException({
            code: 'CONTENT_SITE_NOT_FOUND',
            detail: 'Content Site assignment was not found.',
          });
        }
        return rows[0];
      }
    }

    interface ContentSiteRow {
      id: string;
      workspace_id: string;
      content_id: string;
      site_id: string;
      site_key?: string;
      site_name?: string;
      slug: string;
      title_override: string | null;
      summary_override: string | null;
      seo_json: Record<string, unknown>;
      visibility: ContentSiteVisibility;
      version: number;
      created_at: Date | string;
      updated_at: Date | string;
      active_publication_id?: string | null;
      active_revision_number?: number | null;
      active_published_at?: Date | string | null;
      active_etag?: string | null;
    }

    interface ReadyRevisionRow {
      content_status: string;
      ready_revision_number: number | null;
      revision_id: string | null;
      revision_number: number;
      title: string;
      excerpt: string | null;
      body_html: string;
    }

    interface PublicationRow {
      id: string;
      workspace_id: string;
      content_site_id: string;
      content_id: string;
      site_id: string;
      revision_id: string;
      revision_number: number;
      status: PublicationStatus;
      slug: string;
      title: string;
      summary: string | null;
      body_html: string;
      seo_json: Record<string, unknown>;
      visibility: ContentSiteVisibility;
      etag: string;
      published_at: Date | string;
      superseded_at: Date | string | null;
      withdrawn_at: Date | string | null;
      created_by_admin_account_id: string | null;
      created_at: Date | string;
    }

    function toContentSite(row: ContentSiteRow | undefined) {
      if (!row) throw new Error('Content Site row was not returned.');
      return {
        id: row.id,
        workspaceId: row.workspace_id,
        contentId: row.content_id,
        siteId: row.site_id,
        ...(row.site_key ? { siteKey: row.site_key } : {}),
        ...(row.site_name ? { siteName: row.site_name } : {}),
        slug: row.slug,
        ...(row.title_override ? { titleOverride: row.title_override } : {}),
        ...(row.summary_override ? { summaryOverride: row.summary_override } : {}),
        seo: row.seo_json ?? {},
        visibility: row.visibility,
        version: row.version,
        activePublication: row.active_publication_id
          ? {
              id: row.active_publication_id,
              revisionNumber: row.active_revision_number,
              publishedAt: toIso(row.active_published_at),
              etag: row.active_etag,
            }
          : undefined,
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at),
      };
    }

    function toPublication(row: PublicationRow | undefined) {
      if (!row) throw new Error('Publication row was not returned.');
      return {
        id: row.id,
        workspaceId: row.workspace_id,
        contentSiteId: row.content_site_id,
        contentId: row.content_id,
        siteId: row.site_id,
        revisionId: row.revision_id,
        revisionNumber: row.revision_number,
        status: row.status,
        slug: row.slug,
        title: row.title,
        ...(row.summary ? { summary: row.summary } : {}),
        bodyHtml: row.body_html,
        seo: row.seo_json ?? {},
        visibility: row.visibility,
        etag: row.etag,
        publishedAt: toIso(row.published_at),
        ...(row.superseded_at ? { supersededAt: toIso(row.superseded_at) } : {}),
        ...(row.withdrawn_at ? { withdrawnAt: toIso(row.withdrawn_at) } : {}),
        ...(row.created_by_admin_account_id
          ? { createdByAdminAccountId: row.created_by_admin_account_id }
          : {}),
        createdAt: toIso(row.created_at),
      };
    }

    function normalizeSlug(value: string) {
      const slug = value.trim().toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug) || slug.length > 160) {
        throw new BadRequestException({
          code: 'CONTENT_SITE_SLUG_INVALID',
          detail: 'Slug must contain lowercase letters, digits and single hyphens.',
        });
      }
      return slug;
    }

    function normalizeOptional(value: string | undefined) {
      const normalized = value?.trim();
      return normalized ? normalized : null;
    }

    function hashSnapshot(value: unknown) {
      return createHash('sha256').update(JSON.stringify(value)).digest('hex');
    }

    function toIso(value: Date | string | null | undefined) {
      return value ? new Date(value).toISOString() : undefined;
    }

    function isUniqueViolation(error: unknown): boolean {
      return Boolean(
        error &&
          typeof error === 'object' &&
          'code' in error &&
          (error as { code?: string }).code === '23505',
      );
    }
    ''',
)

write(
    "apps/api/src/content/content-publication.controller.ts",
    r'''
    import {
      Body,
      Controller,
      Get,
      Header,
      HttpCode,
      HttpStatus,
      Param,
      Patch,
      Post,
      Req,
      UseGuards,
    } from '@nestjs/common';
    import { ApiTags } from '@nestjs/swagger';

    import { AdminPermission } from '@atlas/server';

    import { AdminCsrfGuard } from '../admin-session/admin-csrf.guard';
    import {
      AdminPermissionGuard,
      RequireAdminPermission,
    } from '../admin-session/admin-permission.guard';
    import { AdminSessionGuard } from '../admin-session/admin-session.guard';
    import { AdminWorkspaceGuard } from '../admin-sites/admin-workspace.guard';
    import {
      requireAdminWorkspace,
      type AdminWorkspaceHttpRequest,
    } from '../admin-sites/admin-workspace.request';
    import {
      ContentPublicationService,
      type ContentSiteInput,
      type UpdateContentSiteInput,
    } from './content-publication.service';

    @ApiTags('Admin Content Publication')
    @Controller('admin/v1/contents/:contentId/sites')
    export class ContentPublicationController {
      public constructor(private readonly publicationService: ContentPublicationService) {}

      @Get()
      @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminPermissionGuard)
      @RequireAdminPermission(AdminPermission.CONTENTS_READ)
      @Header('Cache-Control', 'no-store')
      public async list(
        @Req() request: AdminWorkspaceHttpRequest,
        @Param('contentId') contentId: string,
      ) {
        const workspace = requireAdminWorkspace(request);
        return { data: await this.publicationService.listContentSites(workspace.id, contentId) };
      }

      @Post()
      @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
      @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
      @HttpCode(HttpStatus.CREATED)
      @Header('Cache-Control', 'no-store')
      public async create(
        @Req() request: AdminWorkspaceHttpRequest,
        @Param('contentId') contentId: string,
        @Body() body: ContentSiteInput,
      ) {
        const workspace = requireAdminWorkspace(request);
        return {
          data: await this.publicationService.createContentSite(workspace.id, contentId, body),
        };
      }

      @Patch(':contentSiteId')
      @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
      @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
      @Header('Cache-Control', 'no-store')
      public async update(
        @Req() request: AdminWorkspaceHttpRequest,
        @Param('contentId') contentId: string,
        @Param('contentSiteId') contentSiteId: string,
        @Body() body: UpdateContentSiteInput,
      ) {
        const workspace = requireAdminWorkspace(request);
        return {
          data: await this.publicationService.updateContentSite(
            workspace.id,
            contentId,
            contentSiteId,
            body,
          ),
        };
      }

      @Post(':contentSiteId/publish')
      @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
      @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
      @HttpCode(HttpStatus.CREATED)
      @Header('Cache-Control', 'no-store')
      public async publish(
        @Req() request: AdminWorkspaceHttpRequest,
        @Param('contentId') contentId: string,
        @Param('contentSiteId') contentSiteId: string,
      ) {
        const workspace = requireAdminWorkspace(request);
        return {
          data: await this.publicationService.publish(workspace.id, contentId, contentSiteId),
        };
      }

      @Post(':contentSiteId/withdraw')
      @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
      @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
      @Header('Cache-Control', 'no-store')
      public async withdraw(
        @Req() request: AdminWorkspaceHttpRequest,
        @Param('contentId') contentId: string,
        @Param('contentSiteId') contentSiteId: string,
      ) {
        const workspace = requireAdminWorkspace(request);
        return {
          data: await this.publicationService.withdraw(workspace.id, contentId, contentSiteId),
        };
      }

      @Get(':contentSiteId/publications')
      @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminPermissionGuard)
      @RequireAdminPermission(AdminPermission.CONTENTS_READ)
      @Header('Cache-Control', 'no-store')
      public async history(
        @Req() request: AdminWorkspaceHttpRequest,
        @Param('contentId') contentId: string,
        @Param('contentSiteId') contentSiteId: string,
      ) {
        const workspace = requireAdminWorkspace(request);
        return {
          data: await this.publicationService.listPublications(
            workspace.id,
            contentId,
            contentSiteId,
          ),
        };
      }

      @Post(':contentSiteId/publications/:publicationId/rollback')
      @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
      @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
      @HttpCode(HttpStatus.CREATED)
      @Header('Cache-Control', 'no-store')
      public async rollback(
        @Req() request: AdminWorkspaceHttpRequest,
        @Param('contentId') contentId: string,
        @Param('contentSiteId') contentSiteId: string,
        @Param('publicationId') publicationId: string,
      ) {
        const workspace = requireAdminWorkspace(request);
        return {
          data: await this.publicationService.rollback(
            workspace.id,
            contentId,
            contentSiteId,
            publicationId,
          ),
        };
      }
    }
    ''',
)

add_unique_to_module(
    "apps/api/src/content/content.module.ts",
    "import { ContentPublicationController } from './content-publication.controller';",
    "controllers",
    "ContentPublicationController",
)
add_unique_to_module(
    "apps/api/src/content/content.module.ts",
    "import { ContentPublicationService } from './content-publication.service';",
    "providers",
    "ContentPublicationService",
)
