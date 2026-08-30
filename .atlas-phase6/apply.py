from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    if new in content:
        return
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one marker, found {count}: {old!r}')
    write(path, content.replace(old, new, 1))


# Shared module export.
modules_path = 'packages/server/src/modules/index.ts'
modules = read(modules_path)
if "export * from './content';" not in modules:
    lines = modules.splitlines()
    insert_at = 1 if lines else 0
    lines.insert(insert_at, "export * from './content';")
    write(modules_path, '\n'.join(lines) + '\n')

# Permission registry. OWNER/ADMIN derive from the full registry in the current implementation.
permission_path = 'packages/server/src/modules/identity/domain/admin-permission.ts'
permission = read(permission_path)
if "CONTENTS_READ: 'contents:read'" not in permission:
    start = permission.index('export const AdminPermission = {')
    end = permission.index('} as const;', start)
    addition = "  CONTENTS_MANAGE: 'contents:manage',\n  CONTENTS_READ: 'contents:read',\n"
    permission = permission[:end] + addition + permission[end:]
    write(permission_path, permission)

# TypeORM CLI entity registry.
data_source_path = 'packages/database/src/data-source.ts'
data_source = read(data_source_path)
if 'ContentDraftEntity' not in data_source:
    import_marker = '  AuditLogEntity,\n'
    entity_marker = '    AuditLogEntity,\n'
    if import_marker not in data_source or entity_marker not in data_source:
        raise RuntimeError('TypeORM entity registry markers were not found.')
    data_source = data_source.replace(
        import_marker,
        import_marker + '  ContentDraftEntity,\n  ContentEntity,\n  ContentRevisionEntity,\n',
        1,
    )
    data_source = data_source.replace(
        entity_marker,
        entity_marker + '    ContentDraftEntity,\n    ContentEntity,\n    ContentRevisionEntity,\n',
        1,
    )
    write(data_source_path, data_source)

# Nest application module.
app_path = 'apps/api/src/app.module.ts'
app = read(app_path)
if "import { ContentModule } from './content/content.module';" not in app:
    marker = "import { HealthModule } from './health/health.module';\n"
    if marker not in app:
        raise RuntimeError('AppModule import marker was not found.')
    app = app.replace(
        marker,
        "import { ContentModule } from './content/content.module';\n" + marker,
        1,
    )

if '    ContentModule,\n' not in app:
    marker = '    HealthModule,\n'
    if marker not in app:
        raise RuntimeError('AppModule module-list marker was not found.')
    app = app.replace(marker, '    ContentModule,\n' + marker, 1)
write(app_path, app)

# Admin navigation.
navigation_path = 'apps/admin-web/src/components/admin/admin-navigation.tsx'
navigation = read(navigation_path)
if "href: '/admin/contents'" not in navigation:
    marker = "  { href: '/admin', label: 'Dashboard', exact: true },\n"
    if marker not in navigation:
        raise RuntimeError('Admin navigation active marker was not found.')
    navigation = navigation.replace(
        marker,
        marker + "  { href: '/admin/contents', label: '콘텐츠', exact: false },\n",
        1,
    )
navigation = navigation.replace("'콘텐츠', ", '')
navigation = navigation.replace("'콘텐츠',", '')
write(navigation_path, navigation)

# Correct the generated API client in one deterministic write.
write(
    'apps/admin-web/src/features/content/content-api.ts',
    '''import { createAdminApiClient } from '../../lib/api';
import type {
  ApiEnvelope,
  Content,
  ContentListResult,
  ContentRevision,
  ContentStatus,
  ContentType,
} from './content-types';

export interface ContentListInput {
  limit?: number;
  cursor?: string;
  search?: string;
  status?: ContentStatus;
  type?: ContentType;
}

function client() {
  return createAdminApiClient();
}

export async function loadContents(
  input: ContentListInput = {},
): Promise<ContentListResult> {
  const response = await client().get<ApiEnvelope<ContentListResult>>(
    buildContentListPath(input),
  );
  return response.data;
}

export function buildContentListPath(input: ContentListInput = {}): string {
  const query = new URLSearchParams();

  if (input.limit !== undefined) query.set('limit', String(input.limit));
  if (input.cursor) query.set('cursor', input.cursor);
  if (input.search?.trim()) query.set('search', input.search.trim());
  if (input.status) query.set('status', input.status);
  if (input.type) query.set('type', input.type);

  const suffix = query.toString();
  return `/contents${suffix ? `?${suffix}` : ''}`;
}

export async function createContent(input: {
  type: ContentType;
  title?: string;
  summary?: string;
  bodyMarkdown?: string;
}): Promise<Content> {
  const response = await client().post<ApiEnvelope<Content>>('/contents', input);
  return response.data;
}

export async function loadContent(contentId: string): Promise<Content> {
  const response = await client().get<ApiEnvelope<Content>>(
    `/contents/${encodeURIComponent(contentId)}`,
  );
  return response.data;
}

export async function saveContentDraft(
  contentId: string,
  input: {
    draftVersion: number;
    title: string;
    summary?: string;
    bodyMarkdown: string;
  },
): Promise<Content> {
  const response = await client().patch<ApiEnvelope<Content>>(
    `/contents/${encodeURIComponent(contentId)}/draft`,
    input,
  );
  return response.data;
}

export async function previewContentById(
  contentId: string,
  input: { title?: string; summary?: string; bodyMarkdown: string },
): Promise<{ html: string; warnings: readonly string[] }> {
  const response = await client().post<
    ApiEnvelope<{ html: string; warnings: readonly string[] }>
  >(`/contents/${encodeURIComponent(contentId)}/preview`, input);
  return response.data;
}

export async function createCheckpoint(
  contentId: string,
  input: { contentVersion: number; draftVersion: number; note?: string },
): Promise<Content> {
  const response = await client().post<ApiEnvelope<Content>>(
    `/contents/${encodeURIComponent(contentId)}/checkpoints`,
    input,
  );
  return response.data;
}

export async function createReadyRevision(
  contentId: string,
  input: { contentVersion: number; draftVersion: number; note?: string },
): Promise<Content> {
  const response = await client().post<ApiEnvelope<Content>>(
    `/contents/${encodeURIComponent(contentId)}/ready`,
    input,
  );
  return response.data;
}

export async function loadContentRevisions(
  contentId: string,
): Promise<readonly ContentRevision[]> {
  const response = await client().get<ApiEnvelope<readonly ContentRevision[]>>(
    `/contents/${encodeURIComponent(contentId)}/revisions`,
  );
  return response.data;
}

export async function restoreContentRevision(
  contentId: string,
  revisionId: string,
  draftVersion: number,
): Promise<Content> {
  const response = await client().post<ApiEnvelope<Content>>(
    `/contents/${encodeURIComponent(contentId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
    { draftVersion },
  );
  return response.data;
}

export async function archiveContent(
  contentId: string,
  contentVersion: number,
): Promise<Content> {
  const response = await client().post<ApiEnvelope<Content>>(
    `/contents/${encodeURIComponent(contentId)}/archive`,
    { contentVersion },
  );
  return response.data;
}
''',
)

# Remove the temporary cast from Content creation.
service_path = 'packages/server/src/modules/content/application/content.service.ts'
service = read(service_path)
old = """      await this.repository.insert(
        { content: { ...content, draft: undefined } as never, draft: content.draft },
        transaction,
      );
"""
new = """      await this.repository.insert(
        {
          content: {
            id: content.id,
            workspaceId: content.workspaceId,
            type: content.type,
            status: content.status,
            version: content.version,
            currentRevisionNumber: content.currentRevisionNumber,
            readyRevisionNumber: content.readyRevisionNumber,
            archivedAt: content.archivedAt,
            createdByAdminAccountId: content.createdByAdminAccountId,
            createdAt: content.createdAt,
            updatedAt: content.updatedAt,
          },
          draft: content.draft,
        },
        transaction,
      );
"""
if old in service:
    service = service.replace(old, new, 1)
write(service_path, service)

# Progress record.
progress_path = 'docs/implementation/progress.md'
progress = read(progress_path)
if '### Phase 6. Content Draft & Revision' not in progress:
    progress += '''

### Phase 6. Content Draft & Revision

완료된 구현 단위:

- Workspace Content와 Mutable ContentDraft
- 별도 Content Version과 Draft Version
- Debounce Markdown Autosave
- Server-side Markdown Preview와 Sanitization
- Immutable Checkpoint·READY Revision
- Latest Revision과 READY Revision Pointer 분리
- PostgreSQL Revision UPDATE·DELETE 차단 Trigger
- READY Validation
- Revision 목록과 Draft 복구
- Optimistic Conflict 처리
- Admin Content 목록과 Editor

다음 단계:

```text
ContentSite Assignment
→ Site별 Slug·SEO Override
→ READY Revision Publication
→ Delivery API
```
'''
    write(progress_path, progress)

print('Phase 6 integration patches applied.')
