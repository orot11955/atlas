export type ContentType = 'post' | 'page' | 'document';
export type ContentStatus = 'draft' | 'ready' | 'archived';
export type ContentRevisionKind = 'checkpoint' | 'ready';

export interface ContentRecord {
  id: string;
  workspaceId: string;
  type: ContentType;
  status: ContentStatus;
  version: number;
  currentRevisionNumber?: number;
  readyRevisionNumber?: number;
  archivedAt?: Date;
  createdByAdminAccountId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentDraftRecord {
  contentId: string;
  workspaceId: string;
  title: string;
  summary?: string;
  bodyMarkdown: string;
  draftVersion: number;
  updatedByAdminAccountId: string;
  updatedAt: Date;
}

export interface ContentRevisionRecord {
  id: string;
  contentId: string;
  workspaceId: string;
  revisionNumber: number;
  kind: ContentRevisionKind;
  title: string;
  summary?: string;
  bodyMarkdown: string;
  bodyHtml: string;
  sourceDraftVersion: number;
  note?: string;
  createdByAdminAccountId: string;
  createdAt: Date;
}

export interface ContentDetailRecord extends ContentRecord {
  draft: ContentDraftRecord;
}

export interface ContentListRecord extends ContentDetailRecord {}

export interface CreateContentInput {
  type: ContentType;
  title: string;
  summary?: string;
  bodyMarkdown?: string;
}

export interface UpdateContentDraftInput {
  draftVersion: number;
  title: string;
  summary?: string;
  bodyMarkdown: string;
}

export interface CreateContentRevisionInput {
  contentVersion: number;
  draftVersion: number;
  note?: string;
}

export interface RestoreContentRevisionInput {
  draftVersion: number;
}

export interface ArchiveContentInput {
  contentVersion: number;
}

export interface ContentListQuery {
  type?: ContentType;
  status?: ContentStatus;
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface ContentListResult {
  items: readonly ContentListRecord[];
  nextCursor?: string;
}

export interface MarkdownPreview {
  html: string;
  warnings: readonly string[];
}

const CONTENT_TYPES = Object.freeze<readonly ContentType[]>([
  'post',
  'page',
  'document',
]);
const CONTENT_STATUSES = Object.freeze<readonly ContentStatus[]>([
  'draft',
  'ready',
  'archived',
]);

export function isContentType(value: unknown): value is ContentType {
  return typeof value === 'string' && CONTENT_TYPES.includes(value as ContentType);
}

export function isContentStatus(value: unknown): value is ContentStatus {
  return typeof value === 'string' && CONTENT_STATUSES.includes(value as ContentStatus);
}

export function normalizeContentTitle(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

export function normalizeContentSummary(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\s+/gu, ' ');
  return normalized || undefined;
}

export function validateReadyDraft(draft: Readonly<ContentDraftRecord>): readonly string[] {
  const issues: string[] = [];
  if (!normalizeContentTitle(draft.title)) issues.push('title_required');
  if (meaningfulMarkdownLength(draft.bodyMarkdown) < 20) issues.push('body_too_short');
  return Object.freeze(issues);
}

export function meaningfulMarkdownLength(value: string): number {
  return value
    .replace(/```[\s\S]*?```/gu, (block) => block.replace(/```\w*/gu, ''))
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/!\[([^\u005d]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\u005d]+)\]\([^)]*\)/gu, '$1')
    .replace(/[#>*_~\-]+/gu, ' ')
    .replace(/\s+/gu, '')
    .length;
}

export function renderContentMarkdown(markdown: string): MarkdownPreview {
  const warnings = new Set<string>();
  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n');
  const output: string[] = [];
  const paragraph: string[] = [];
  const codeLines: string[] = [];
  let codeOpen = false;
  let codeLanguage = '';
  let listOpen = false;

  function flushParagraph() {
    if (paragraph.length === 0) return;
    output.push(`<p>${renderInline(paragraph.join(' '), warnings)}</p>`);
    paragraph.length = 0;
  }

  function closeList() {
    if (!listOpen) return;
    output.push('</ul>');
    listOpen = false;
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/u, '');
    const fence = /^```\s*([A-Za-z0-9_-]+)?\s*$/u.exec(line);

    if (fence) {
      flushParagraph();
      closeList();
      if (!codeOpen) {
        codeOpen = true;
        codeLanguage = fence[1] ?? '';
        codeLines.length = 0;
      } else {
        const languageAttribute = codeLanguage
          ? ` class="language-${escapeAttribute(codeLanguage)}"`
          : '';
        output.push(
          `<pre><code${languageAttribute}>${escapeHtml(codeLines.join('\n'))}</code></pre>`,
        );
        codeOpen = false;
        codeLanguage = '';
        codeLines.length = 0;
      }
      continue;
    }

    if (codeOpen) {
      codeLines.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1]?.length ?? 1;
      output.push(`<h${level}>${renderInline(heading[2] ?? '', warnings)}</h${level}>`);
      continue;
    }

    const listItem = /^[-*+]\s+(.+)$/u.exec(line);
    if (listItem) {
      flushParagraph();
      if (!listOpen) {
        output.push('<ul>');
        listOpen = true;
      }
      output.push(`<li>${renderInline(listItem[1] ?? '', warnings)}</li>`);
      continue;
    }

    const quote = /^>\s?(.+)$/u.exec(line);
    if (quote) {
      flushParagraph();
      closeList();
      output.push(`<blockquote><p>${renderInline(quote[1] ?? '', warnings)}</p></blockquote>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  if (codeOpen) {
    warnings.add('unclosed_code_fence');
    output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }

  flushParagraph();
  closeList();

  return Object.freeze({
    html: output.join('\n'),
    warnings: Object.freeze([...warnings]),
  });
}

function renderInline(value: string, warnings: Set<string>): string {
  let cursor = 0;
  let output = '';
  const pattern = /\[([^\u005d]+)\]\(([^)]+)\)/gu;

  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    output += renderInlineText(value.slice(cursor, index));
    const label = match[1] ?? '';
    const href = normalizeSafeHref(match[2] ?? '');

    if (href) {
      const external = /^https?:\/\//iu.test(href);
      output += `<a href="${escapeAttribute(href)}"${external ? ' rel="nofollow noopener noreferrer"' : ''}>${renderInlineText(label)}</a>`;
    } else {
      warnings.add('unsafe_link_removed');
      output += renderInlineText(label);
    }
    cursor = index + match[0].length;
  }

  output += renderInlineText(value.slice(cursor));
  return output;
}

function renderInlineText(value: string): string {
  let output = escapeHtmlWithWarnings(value);
  output = output.replace(/`([^`]+)`/gu, '<code>$1</code>');
  output = output.replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>');
  output = output.replace(/__([^_]+)__/gu, '<strong>$1</strong>');
  output = output.replace(/(?<!\*)\*([^*]+)\*(?!\*)/gu, '<em>$1</em>');
  output = output.replace(/(?<!_)_([^_]+)_(?!_)/gu, '<em>$1</em>');
  return output;
}

function normalizeSafeHref(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.startsWith('/') || normalized.startsWith('#')) return normalized;
  try {
    const url = new URL(normalized);
    if (['http:', 'https:', 'mailto:'].includes(url.protocol)) return normalized;
  } catch {
    return undefined;
  }
  return undefined;
}

function escapeHtmlWithWarnings(value: string): string {
  return escapeHtml(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
