from __future__ import annotations

import re
from pathlib import Path
from textwrap import dedent

ROOT = Path.cwd()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(dedent(content).lstrip(), encoding="utf-8")


# Register the migration explicitly in the existing TypeORM DataSource.
data_source = ROOT / "packages/database/src/data-source.ts"
value = data_source.read_text(encoding="utf-8")
migration_class = "CreateContentPublicationDelivery1788076200000"
migration_import = (
    "import { CreateContentPublicationDelivery1788076200000 } "
    "from './migrations/1788076200000-CreateContentPublicationDelivery';"
)
if migration_import not in value:
    imports = list(re.finditer(r"(?m)^import .+;$", value))
    value = value[: imports[-1].end()] + "\n" + migration_import + value[imports[-1].end() :]
match = re.search(r"migrations\s*:\s*\[", value)
if not match:
    raise RuntimeError("TypeORM migrations array was not found.")
start = value.index("[", match.start())
depth = 0
end = None
for index in range(start, len(value)):
    if value[index] == "[":
        depth += 1
    elif value[index] == "]":
        depth -= 1
        if depth == 0:
            end = index
            break
if end is None:
    raise RuntimeError("TypeORM migrations array did not close.")
body = value[start + 1 : end]
if migration_class not in body:
    indentation = "    "
    existing = re.search(r"(?m)^(\s*)\w", body)
    if existing:
        indentation = existing.group(1)
    body = body.rstrip() + f"\n{indentation}{migration_class},\n  "
    value = value[: start + 1] + body + value[end:]
data_source.write_text(value, encoding="utf-8")

write(
    "scripts/ci/content-publication-delivery-e2e.mjs",
    r'''
    import assert from 'node:assert/strict';

    export async function verifyContentPublicationDelivery(...args) {
      const request = findRequest(args);
      assert.equal(typeof request, 'function', 'Authenticated request helper was not provided.');

      const sitesPayload = await request('GET', '/admin/v1/sites?limit=100', undefined, 200);
      const sites = toList(unwrap(sitesPayload));
      assert.ok(sites.length > 0, 'Publication E2E requires at least one Site.');
      let site = sites[0];
      if (site.status !== 'active') {
        site = unwrap(
          await request(
            'POST',
            `/admin/v1/sites/${site.id}/activate`,
            { version: site.version },
            200,
          ),
        );
      }

      const suffix = Date.now().toString(36);
      const created = unwrap(
        await request(
          'POST',
          '/admin/v1/contents',
          {
            siteId: site.id,
            type: 'post',
            title: `Phase 7 Publication ${suffix}`,
            slug: `phase-7-source-${suffix}`,
            bodyMarkdown: 'Initial Phase 7 draft.',
          },
          201,
        ),
      );
      const autosaved = unwrap(
        await request(
          'PATCH',
          `/admin/v1/contents/${created.id}/draft`,
          {
            draftVersion: created.draftVersion,
            title: created.title,
            slug: created.slug,
            excerpt: 'Phase 7 immutable Publication snapshot.',
            bodyMarkdown: '# Published V1\n\nThe first READY body is long enough for validation.',
          },
          200,
        ),
      );
      const readyPayload = unwrap(
        await request(
          'POST',
          `/admin/v1/contents/${created.id}/ready`,
          {
            contentVersion: autosaved.version,
            draftVersion: autosaved.draftVersion,
            note: 'Phase 7 first READY',
          },
          201,
        ),
      );
      let content = unwrap(readyPayload.content ?? readyPayload);
      const firstReady = unwrap(readyPayload.revision);
      assert.equal(firstReady.kind, 'ready');

      const placement = unwrap(
        await request(
          'POST',
          `/admin/v1/contents/${created.id}/sites`,
          {
            siteId: site.id,
            slug: `phase-7-published-${suffix}`,
            visibility: 'public',
            seo: { description: 'Phase 7 E2E' },
          },
          201,
        ),
      );
      const firstPublication = unwrap(
        await request(
          'POST',
          `/admin/v1/contents/${created.id}/sites/${placement.id}/publish`,
          {},
          201,
        ),
      );
      assert.equal(firstPublication.status, 'active');
      assert.equal(firstPublication.revisionNumber, firstReady.revisionNumber);

      const clientPayload = unwrap(
        await request(
          'POST',
          `/admin/v1/sites/${site.id}/api-clients`,
          {
            name: `Phase 7 Delivery ${suffix}`,
            type: 'delivery',
            scopes: ['site:read', 'content:read'],
            allowedOrigins: [],
            rateLimitPerMinute: 120,
          },
          201,
        ),
      );
      const token =
        clientPayload.issuedKey?.token ??
        clientPayload.issuedKey?.key ??
        clientPayload.apiKey ??
        clientPayload.key;
      assert.equal(typeof token, 'string', 'API Client creation did not return a one-time key.');

      const baseUrl = process.env.ATLAS_API_BASE_URL ?? 'http://localhost:4000/api';
      const listResponse = await fetch(`${baseUrl}/delivery/v1/sites/${site.key}/contents`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(listResponse.status, 200);
      const listPayload = await listResponse.json();
      const deliveredList = toList(unwrap(listPayload));
      assert.ok(deliveredList.some((item) => item.publicationId === firstPublication.id));

      const detailUrl = `${baseUrl}/delivery/v1/sites/${site.key}/contents/${placement.slug}`;
      const firstDetailResponse = await fetch(detailUrl, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(firstDetailResponse.status, 200);
      const firstEtag = firstDetailResponse.headers.get('etag');
      assert.match(firstEtag ?? '', /^"[0-9a-f]{64}"$/);
      const firstDetail = unwrap(await firstDetailResponse.json());
      assert.match(firstDetail.bodyHtml, /Published V1/);

      const notModified = await fetch(detailUrl, {
        headers: {
          authorization: `Bearer ${token}`,
          'if-none-match': firstEtag,
        },
      });
      assert.equal(notModified.status, 304);

      const edited = unwrap(
        await request(
          'PATCH',
          `/admin/v1/contents/${created.id}/draft`,
          {
            draftVersion: content.draftVersion,
            title: content.title,
            slug: content.slug,
            excerpt: 'Edited after first Publication.',
            bodyMarkdown: '# Draft V2\n\nThis Draft edit must not mutate the active Publication.',
          },
          200,
        ),
      );
      const unchangedResponse = await fetch(detailUrl, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(unchangedResponse.status, 200);
      const unchanged = unwrap(await unchangedResponse.json());
      assert.match(unchanged.bodyHtml, /Published V1/);
      assert.doesNotMatch(unchanged.bodyHtml, /Draft V2/);

      const secondReadyPayload = unwrap(
        await request(
          'POST',
          `/admin/v1/contents/${created.id}/ready`,
          {
            contentVersion: edited.version,
            draftVersion: edited.draftVersion,
            note: 'Phase 7 second READY',
          },
          201,
        ),
      );
      content = unwrap(secondReadyPayload.content ?? secondReadyPayload);
      const secondReady = unwrap(secondReadyPayload.revision);
      const secondPublication = unwrap(
        await request(
          'POST',
          `/admin/v1/contents/${created.id}/sites/${placement.id}/publish`,
          {},
          201,
        ),
      );
      assert.equal(secondPublication.status, 'active');
      assert.equal(secondPublication.revisionNumber, secondReady.revisionNumber);

      const history = toList(
        unwrap(
          await request(
            'GET',
            `/admin/v1/contents/${created.id}/sites/${placement.id}/publications`,
            undefined,
            200,
          ),
        ),
      );
      assert.equal(history.filter((item) => item.status === 'active').length, 1);
      assert.ok(history.some((item) => item.id === firstPublication.id && item.status === 'superseded'));

      const rollback = unwrap(
        await request(
          'POST',
          `/admin/v1/contents/${created.id}/sites/${placement.id}/publications/${firstPublication.id}/rollback`,
          {},
          201,
        ),
      );
      assert.equal(rollback.status, 'active');
      assert.equal(rollback.revisionNumber, firstPublication.revisionNumber);
      assert.notEqual(rollback.id, firstPublication.id);

      const rolledBackResponse = await fetch(detailUrl, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(rolledBackResponse.status, 200);
      const rolledBack = unwrap(await rolledBackResponse.json());
      assert.match(rolledBack.bodyHtml, /Published V1/);

      await request(
        'POST',
        `/admin/v1/contents/${created.id}/sites/${placement.id}/withdraw`,
        {},
        200,
      );
      const withdrawnResponse = await fetch(detailUrl, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(withdrawnResponse.status, 404);

      assert.equal(content.readyRevisionNumber ?? secondReady.revisionNumber, secondReady.revisionNumber);
    }

    function findRequest(args) {
      for (const argument of args) {
        if (typeof argument === 'function' && /request/i.test(argument.name || 'request')) return argument;
        if (argument && typeof argument === 'object') {
          for (const key of ['request', 'adminRequest', 'authenticatedRequest']) {
            if (typeof argument[key] === 'function') return argument[key];
          }
        }
      }
      return args.find((argument) => typeof argument === 'function');
    }

    function unwrap(payload) {
      if (payload && typeof payload === 'object' && 'data' in payload) return payload.data;
      return payload;
    }

    function toList(payload) {
      if (Array.isArray(payload)) return payload;
      if (payload && Array.isArray(payload.items)) return payload.items;
      if (payload && Array.isArray(payload.data)) return payload.data;
      return [];
    }
    ''',
)
