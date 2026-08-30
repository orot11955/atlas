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
    "apps/api/src/api-clients/delivery-content.service.ts",
    r'''
    import {
      BadRequestException,
      Injectable,
      NotFoundException,
      UnauthorizedException,
    } from '@nestjs/common';
    import { DataSource } from 'typeorm';

    @Injectable()
    export class DeliveryContentService {
      public constructor(private readonly dataSource: DataSource) {}

      public async list(
        siteKey: string,
        authorization: string | undefined,
        input: { limit?: number; cursor?: string },
      ) {
        const keyId = parseKeyId(authorization);
        const limit = normalizeLimit(input.limit);
        const cursor = decodeCursor(input.cursor);
        const parameters: unknown[] = [keyId, siteKey, limit + 1];
        let cursorClause = '';
        if (cursor) {
          parameters.push(cursor.publishedAt, cursor.id);
          cursorClause = `
            AND (p.published_at < $4 OR (p.published_at = $4 AND p.id < $5))`;
        }
        const rows = (await this.dataSource.query(
          `SELECT
             p.id,
             p.content_id,
             p.revision_number,
             p.slug,
             p.title,
             p.summary,
             p.body_html,
             p.seo_json,
             p.visibility,
             p.etag,
             p.published_at,
             s.id AS site_id,
             s.key AS site_key,
             s.name AS site_name
           FROM api_client_keys k
           JOIN api_clients c
             ON c.id = k.api_client_id AND c.status = 'active'
           JOIN api_client_site_access access
             ON access.api_client_id = c.id
           JOIN api_client_scopes scope
             ON scope.api_client_id = c.id AND scope.scope = 'content:read'
           JOIN sites s
             ON s.id = access.site_id AND s.workspace_id = c.workspace_id
           JOIN content_publications p
             ON p.site_id = s.id
            AND p.workspace_id = s.workspace_id
            AND p.status = 'active'
            AND p.visibility = 'public'
           WHERE k.id = $1
             AND s.key = $2
             AND s.status = 'active'
             ${cursorClause}
           ORDER BY p.published_at DESC, p.id DESC
           LIMIT $3`,
          parameters,
        )) as DeliveryPublicationRow[];
        const hasMore = rows.length > limit;
        const selected = hasMore ? rows.slice(0, limit) : rows;
        const last = selected.at(-1);
        return {
          items: selected.map(toDeliveryItem),
          pageInfo: {
            ...(hasMore && last
              ? { nextCursor: encodeCursor(last.published_at, last.id) }
              : {}),
          },
        };
      }

      public async get(
        siteKey: string,
        slug: string,
        authorization: string | undefined,
      ) {
        const keyId = parseKeyId(authorization);
        const rows = (await this.dataSource.query(
          `SELECT
             p.id,
             p.content_id,
             p.revision_number,
             p.slug,
             p.title,
             p.summary,
             p.body_html,
             p.seo_json,
             p.visibility,
             p.etag,
             p.published_at,
             s.id AS site_id,
             s.key AS site_key,
             s.name AS site_name
           FROM api_client_keys k
           JOIN api_clients c
             ON c.id = k.api_client_id AND c.status = 'active'
           JOIN api_client_site_access access
             ON access.api_client_id = c.id
           JOIN api_client_scopes scope
             ON scope.api_client_id = c.id AND scope.scope = 'content:read'
           JOIN sites s
             ON s.id = access.site_id AND s.workspace_id = c.workspace_id
           JOIN content_publications p
             ON p.site_id = s.id
            AND p.workspace_id = s.workspace_id
            AND p.status = 'active'
            AND p.visibility IN ('public', 'unlisted')
           WHERE k.id = $1
             AND s.key = $2
             AND s.status = 'active'
             AND p.slug = $3
           LIMIT 1`,
          [keyId, siteKey, slug.trim().toLowerCase()],
        )) as DeliveryPublicationRow[];
        if (!rows[0]) {
          throw new NotFoundException({
            code: 'DELIVERY_CONTENT_NOT_FOUND',
            detail: 'Published Content was not found.',
          });
        }
        return toDeliveryItem(rows[0]);
      }
    }

    interface DeliveryPublicationRow {
      id: string;
      content_id: string;
      revision_number: number;
      slug: string;
      title: string;
      summary: string | null;
      body_html: string;
      seo_json: Record<string, unknown>;
      visibility: 'public' | 'unlisted' | 'private';
      etag: string;
      published_at: Date | string;
      site_id: string;
      site_key: string;
      site_name: string;
    }

    function toDeliveryItem(row: DeliveryPublicationRow) {
      return {
        publicationId: row.id,
        contentId: row.content_id,
        revisionNumber: row.revision_number,
        site: { id: row.site_id, key: row.site_key, name: row.site_name },
        slug: row.slug,
        title: row.title,
        ...(row.summary ? { summary: row.summary } : {}),
        bodyHtml: row.body_html,
        seo: row.seo_json ?? {},
        visibility: row.visibility,
        etag: row.etag,
        publishedAt: new Date(row.published_at).toISOString(),
      };
    }

    function parseKeyId(authorization: string | undefined) {
      const match = /^Bearer\s+atlas_live_([0-9a-f-]{36})\./iu.exec(authorization ?? '');
      if (!match?.[1]) {
        throw new UnauthorizedException({
          code: 'API_CLIENT_TOKEN_INVALID',
          detail: 'A valid API Client Bearer token is required.',
        });
      }
      return match[1];
    }

    function normalizeLimit(value: number | undefined) {
      if (value === undefined) return 20;
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new BadRequestException({
          code: 'DELIVERY_LIMIT_INVALID',
          detail: 'Limit must be an integer between 1 and 100.',
        });
      }
      return value;
    }

    function encodeCursor(value: Date | string, id: string) {
      return Buffer.from(
        JSON.stringify({ publishedAt: new Date(value).toISOString(), id }),
        'utf8',
      ).toString('base64url');
    }

    function decodeCursor(value: string | undefined) {
      if (!value) return undefined;
      try {
        const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
          publishedAt?: string;
          id?: string;
        };
        if (!decoded.publishedAt || !decoded.id || Number.isNaN(Date.parse(decoded.publishedAt))) {
          throw new Error('Invalid cursor fields.');
        }
        return { publishedAt: new Date(decoded.publishedAt), id: decoded.id };
      } catch {
        throw new BadRequestException({
          code: 'DELIVERY_CURSOR_INVALID',
          detail: 'Delivery cursor is invalid.',
        });
      }
    }
    ''',
)

# Reuse the exact API Client guard and scope decorator names already used by the Site Delivery endpoint.
source = (ROOT / "apps/api/src/api-clients/delivery-site.controller.ts").read_text(encoding="utf-8")
guard_import_match = re.search(
    r"(?m)^import\s*\{[^\n]*ApiClientAuthGuard[^\n]*\}\s*from\s*['\"]\.\/api-client-auth\.guard['\"];",
    source,
)
if not guard_import_match:
    guard_import_match = re.search(
        r"import\s*\{[\s\S]*?ApiClientAuthGuard[\s\S]*?\}\s*from\s*['\"]\.\/api-client-auth\.guard['\"];",
        source,
    )
if not guard_import_match:
    raise RuntimeError("ApiClientAuthGuard import was not found.")
guard_import = guard_import_match.group(0)

guard_names = [
    token.strip()
    for token in re.search(r"\{([\s\S]*?)\}", guard_import).group(1).split(",")
    if token.strip()
]
guard_class = next((name for name in guard_names if name.endswith("Guard")), "ApiClientAuthGuard")
scope_decorator = next(
    (name for name in guard_names if "Scope" in name and not name.endswith("Guard")),
    None,
)
if scope_decorator is None:
    decorator_match = re.search(r"@(\w*Scope\w*)\(", source)
    if not decorator_match:
        raise RuntimeError("API Client scope decorator was not found.")
    scope_decorator = decorator_match.group(1)

scope_import_match = re.search(
    r"import\s*\{[\s\S]*?ApiClientScope[\s\S]*?\}\s*from\s*['\"]@atlas\/server['\"];",
    source,
)
scope_import = scope_import_match.group(0) if scope_import_match else "import { ApiClientScope } from '@atlas/server';"

write(
    "apps/api/src/api-clients/delivery-content.controller.ts",
    f'''
    import {{ Controller, Get, Param, Req, UseGuards }} from '@nestjs/common';
    {scope_import}
    {guard_import}

    import {{ DeliveryContentService }} from './delivery-content.service';

    interface DeliveryContentRequest {{
      headers: Record<string, string | string[] | undefined>;
      query?: Record<string, string | string[] | undefined>;
      res?: {{
        setHeader(name: string, value: string): void;
        statusCode: number;
      }};
    }}

    @Controller('delivery/v1/sites')
    export class DeliveryContentController {{
      public constructor(private readonly deliveryContentService: DeliveryContentService) {{}}

      @Get(':siteKey/contents')
      @UseGuards({guard_class})
      @{scope_decorator}(ApiClientScope.CONTENT_READ)
      public async list(
        @Req() request: DeliveryContentRequest,
        @Param('siteKey') siteKey: string,
      ) {{
        const limitValue = first(request.query?.limit);
        const result = await this.deliveryContentService.list(
          siteKey,
          first(request.headers.authorization),
          {{
            ...(limitValue ? {{ limit: Number(limitValue) }} : {{}}),
            ...(first(request.query?.cursor)
              ? {{ cursor: first(request.query?.cursor) }}
              : {{}}),
          }},
        );
        request.res?.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        return {{ data: result }};
      }}

      @Get(':siteKey/contents/:slug')
      @UseGuards({guard_class})
      @{scope_decorator}(ApiClientScope.CONTENT_READ)
      public async get(
        @Req() request: DeliveryContentRequest,
        @Param('siteKey') siteKey: string,
        @Param('slug') slug: string,
      ) {{
        const item = await this.deliveryContentService.get(
          siteKey,
          slug,
          first(request.headers.authorization),
        );
        const etag = `"${{item.etag}}"`;
        request.res?.setHeader('ETag', etag);
        request.res?.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        const ifNoneMatch = first(request.headers['if-none-match']);
        if (ifNoneMatch?.split(',').map((value) => value.trim()).includes(etag)) {{
          if (request.res) request.res.statusCode = 304;
          return undefined;
        }}
        return {{ data: item }};
      }}
    }}

    function first(value: string | string[] | undefined): string | undefined {{
      return Array.isArray(value) ? value[0] : value;
    }}
    ''',
)

add_unique_to_module(
    "apps/api/src/api-clients/api-client.module.ts",
    "import { DeliveryContentController } from './delivery-content.controller';",
    "controllers",
    "DeliveryContentController",
)
add_unique_to_module(
    "apps/api/src/api-clients/api-client.module.ts",
    "import { DeliveryContentService } from './delivery-content.service';",
    "providers",
    "DeliveryContentService",
)

write(
    "apps/admin-web/src/features/content/content-publication.tsx",
    r'''
    'use client';

    import { useCallback, useEffect, useState } from 'react';

    import { ContentApiError, contentApi, type SiteOption } from './content-api';

    type Visibility = 'public' | 'unlisted' | 'private';

    interface ContentSite {
      id: string;
      siteId: string;
      siteKey?: string;
      siteName?: string;
      slug: string;
      titleOverride?: string;
      summaryOverride?: string;
      visibility: Visibility;
      version: number;
      activePublication?: {
        id: string;
        revisionNumber: number;
        publishedAt: string;
        etag: string;
      };
    }

    interface Publication {
      id: string;
      revisionNumber: number;
      status: 'active' | 'superseded' | 'withdrawn' | 'failed';
      slug: string;
      title: string;
      publishedAt: string;
      etag: string;
    }

    export function ContentPublicationManager({ contentId }: { contentId: string }) {
      const [sites, setSites] = useState<SiteOption[]>([]);
      const [assignments, setAssignments] = useState<ContentSite[]>([]);
      const [histories, setHistories] = useState<Record<string, Publication[]>>({});
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState<string>();
      const [form, setForm] = useState({ siteId: '', slug: '', visibility: 'public' as Visibility });

      const load = useCallback(async () => {
        setLoading(true);
        setError(undefined);
        try {
          const [sitePayload, placementData] = await Promise.all([
            contentApi<SiteOption[] | { items: SiteOption[] }>('/admin/v1/sites?limit=100'),
            contentApi<ContentSite[]>(`/admin/v1/contents/${contentId}/sites`),
          ]);
          const siteData = Array.isArray(sitePayload) ? sitePayload : sitePayload.items;
          setSites(siteData);
          setAssignments(placementData);
          setForm((current) => ({ ...current, siteId: current.siteId || siteData[0]?.id || '' }));
        } catch (cause) {
          setError(message(cause));
        } finally {
          setLoading(false);
        }
      }, [contentId]);

      useEffect(() => {
        void load();
      }, [load]);

      async function createAssignment() {
        setError(undefined);
        try {
          await contentApi(`/admin/v1/contents/${contentId}/sites`, {
            method: 'POST',
            body: JSON.stringify(form),
          });
          setForm((current) => ({ ...current, slug: '' }));
          await load();
        } catch (cause) {
          setError(message(cause));
        }
      }

      async function action(path: string) {
        setError(undefined);
        try {
          await contentApi(path, { method: 'POST', body: '{}' });
          await load();
        } catch (cause) {
          setError(message(cause));
        }
      }

      async function loadHistory(assignmentId: string) {
        try {
          const history = await contentApi<Publication[]>(
            `/admin/v1/contents/${contentId}/sites/${assignmentId}/publications`,
          );
          setHistories((current) => ({ ...current, [assignmentId]: history }));
        } catch (cause) {
          setError(message(cause));
        }
      }

      return (
        <section style={panel}>
          <header>
            <p style={{ margin: 0, color: 'var(--muted-foreground)' }}>Publication & Delivery</p>
            <h2 style={{ margin: '6px 0 8px' }}>Site별 발행</h2>
            <p style={{ margin: 0 }}>
              READY Revision을 Site별 Slug와 공개 범위로 Snapshot 발행합니다.
            </p>
          </header>

          {error ? <div role="alert" style={alert}>{error}</div> : null}

          <div style={grid}>
            <label style={label}>
              Site
              <select
                value={form.siteId}
                onChange={(event) => setForm((current) => ({ ...current, siteId: event.target.value }))}
                style={input}
              >
                <option value="">Site 선택</option>
                {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
              </select>
            </label>
            <label style={label}>
              Slug
              <input
                value={form.slug}
                onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
                placeholder="my-post"
                style={input}
              />
            </label>
            <label style={label}>
              공개 범위
              <select
                value={form.visibility}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  visibility: event.target.value as Visibility,
                }))}
                style={input}
              >
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled={!form.siteId || !form.slug.trim()}
            onClick={() => void createAssignment()}
            style={primary}
          >
            Site 배치 추가
          </button>

          <div style={{ display: 'grid', gap: 14, marginTop: 20 }}>
            {loading ? <p>불러오는 중…</p> : null}
            {!loading && assignments.length === 0 ? <p>아직 발행 대상 Site가 없습니다.</p> : null}
            {assignments.map((assignment) => (
              <article key={assignment.id} style={card}>
                <div>
                  <strong>{assignment.siteName ?? assignment.siteKey ?? assignment.siteId}</strong>
                  <p style={{ margin: '5px 0' }}>/{assignment.slug} · {assignment.visibility}</p>
                  <p style={{ margin: 0, fontSize: 13 }}>
                    {assignment.activePublication
                      ? `ACTIVE · Revision ${assignment.activePublication.revisionNumber}`
                      : '미발행'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => void action(
                      `/admin/v1/contents/${contentId}/sites/${assignment.id}/publish`,
                    )}
                    style={primary}
                  >
                    READY 발행
                  </button>
                  {assignment.activePublication ? (
                    <button
                      type="button"
                      onClick={() => void action(
                        `/admin/v1/contents/${contentId}/sites/${assignment.id}/withdraw`,
                      )}
                      style={secondary}
                    >
                      발행 취소
                    </button>
                  ) : null}
                  <button type="button" onClick={() => void loadHistory(assignment.id)} style={secondary}>
                    이력
                  </button>
                </div>
                {histories[assignment.id]?.length ? (
                  <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}>
                    {histories[assignment.id].map((publication) => (
                      <div key={publication.id} style={historyRow}>
                        <span>
                          Revision {publication.revisionNumber} · {publication.status} ·{' '}
                          {new Date(publication.publishedAt).toLocaleString('ko-KR')}
                        </span>
                        {publication.status !== 'active' ? (
                          <button
                            type="button"
                            onClick={() => void action(
                              `/admin/v1/contents/${contentId}/sites/${assignment.id}/publications/${publication.id}/rollback`,
                            )}
                            style={secondary}
                          >
                            이 Snapshot으로 Rollback
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      );
    }

    function message(cause: unknown) {
      if (cause instanceof ContentApiError) return `${cause.code}: ${cause.message}`;
      return cause instanceof Error ? cause.message : '발행 요청을 처리하지 못했습니다.';
    }

    const panel = {
      display: 'grid',
      gap: 16,
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: 20,
      background: 'var(--card)',
    } as const;
    const grid = {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: 12,
    } as const;
    const label = { display: 'grid', gap: 6, fontWeight: 600, fontSize: 14 } as const;
    const input = {
      width: '100%',
      boxSizing: 'border-box',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '9px 11px',
      background: 'var(--background)',
      color: 'inherit',
    } as const;
    const primary = {
      border: 0,
      borderRadius: 8,
      padding: '9px 13px',
      fontWeight: 700,
      cursor: 'pointer',
      background: 'var(--primary)',
      color: 'var(--primary-foreground)',
    } as const;
    const secondary = {
      ...primary,
      border: '1px solid var(--border)',
      background: 'var(--background)',
      color: 'inherit',
    } as const;
    const card = {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      gap: 12,
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: 14,
    } as const;
    const historyRow = {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 10,
      alignItems: 'center',
      borderTop: '1px solid var(--border)',
      paddingTop: 8,
      fontSize: 13,
    } as const;
    const alert = {
      border: '1px solid color-mix(in srgb, #ef4444 55%, var(--border))',
      borderRadius: 10,
      padding: 12,
    } as const;
    ''',
)

write(
    "apps/admin-web/src/app/admin/contents/[contentId]/publication/page.tsx",
    r'''
    'use client';

    import Link from 'next/link';
    import { useParams } from 'next/navigation';

    import { ContentPublicationManager } from '../../../../../features/content/content-publication';

    export default function ContentPublicationPage() {
      const params = useParams<{ contentId: string }>();
      return (
        <div style={{ display: 'grid', gap: 18 }}>
          <Link href={`/admin/contents/${params.contentId}`}>← Content Editor</Link>
          <ContentPublicationManager contentId={params.contentId} />
        </div>
      );
    }
    ''',
)

# Add a visible publishing link to the Editor without coupling the publication panel to Autosave state.
editor = ROOT / "apps/admin-web/src/features/content/content-editor.tsx"
value = editor.read_text(encoding="utf-8")
if "publication`" not in value and "발행 관리" not in value:
    marker = "<header>"
    if marker in value:
        value = value.replace(
            marker,
            marker
            + "\n        <p><a href={`/admin/contents/${contentId}/publication`}>Site별 발행 관리 →</a></p>",
            1,
        )
editor.write_text(value, encoding="utf-8")

write(
    "docs/implementation/phase-7-content-publication-delivery.md",
    r'''
    # Phase 7. Content Publication & Delivery

    ## 경계

    - Draft와 Checkpoint는 직접 발행하지 않는다.
    - `ready_revision_number`가 가리키는 READY Revision만 발행한다.
    - 하나의 Content를 여러 Site에 서로 다른 Slug와 Override로 배치할 수 있다.
    - Publication은 READY Revision의 Sanitized HTML Snapshot을 복사한다.
    - Draft 편집은 이미 발행된 Snapshot을 변경하지 않는다.
    - ContentSite에는 ACTIVE Publication이 최대 하나다.
    - Rollback은 과거 Row를 재활성화하지 않고 새 ACTIVE Snapshot을 생성한다.

    ## Delivery

    ```text
    GET /api/delivery/v1/sites/{siteKey}/contents
    GET /api/delivery/v1/sites/{siteKey}/contents/{slug}
    ```

    - `content:read` API Client Scope가 필요하다.
    - API Client가 접근 가능한 Site만 조회한다.
    - 목록에는 `public`만 노출한다.
    - 상세에는 `public`, `unlisted`를 노출하고 `private`은 노출하지 않는다.
    - 상세 응답은 ETag와 `If-None-Match → 304`를 지원한다.
    - Cache-Control은 `public, max-age=60, stale-while-revalidate=300`이다.
    ''',
)
