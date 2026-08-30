import { DomainError, ErrorCode } from '../../../core';

export const ContentType = {
  DOCUMENT: 'document',
  PAGE: 'page',
  POST: 'post',
} as const;

export type ContentType = (typeof ContentType)[keyof typeof ContentType];
export const CONTENT_TYPES = Object.freeze(Object.values(ContentType)) as readonly ContentType[];

export const ContentStatus = {
  ARCHIVED: 'archived',
  DRAFT: 'draft',
  READY: 'ready',
} as const;

export type ContentStatus = (typeof ContentStatus)[keyof typeof ContentStatus];
export const CONTENT_STATUSES = Object.freeze(
  Object.values(ContentStatus),
) as readonly ContentStatus[];

export const ContentRevisionKind = {
  CHECKPOINT: 'checkpoint',
  READY: 'ready',
} as const;

export type ContentRevisionKind = (typeof ContentRevisionKind)[keyof typeof ContentRevisionKind];

export interface ContentDraftSnapshot {
  title: string;
  summary?: string;
  bodyMarkdown: string;
}

export interface ContentDraftRecord extends ContentDraftSnapshot {
  contentId: string;
  workspaceId: string;
  draftVersion: number;
  updatedByAdminAccountId: string;
  updatedAt: Date;
}

export interface ContentRevisionRecord extends ContentDraftSnapshot {
  id: string;
  contentId: string;
  workspaceId: string;
  revisionNumber: number;
  kind: ContentRevisionKind;
  bodyHtml: string;
  sourceDraftVersion: number;
  note?: string;
  createdByAdminAccountId: string;
  createdAt: Date;
}

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
  draft: ContentDraftRecord;
}

export interface MarkdownPreview {
  html: string;
  warnings: readonly string[];
}

export function normalizeContentType(value: string): ContentType {
  if (!CONTENT_TYPES.includes(value as ContentType)) {
    throw validationError('type', 'Content type is invalid.');
  }

  return value as ContentType;
}

export function normalizeContentTitle(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');

  if (normalized.length > 200) {
    throw validationError('title', 'Content title cannot exceed 200 characters.');
  }

  return normalized;
}

export function normalizeContentSummary(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\s+/gu, ' ');

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > 500) {
    throw validationError('summary', 'Content summary cannot exceed 500 characters.');
  }

  return normalized;
}

export function normalizeContentMarkdown(value: string): string {
  const normalized = value.replace(/\r\n?/gu, '\n');

  if (normalized.length > 500_000) {
    throw validationError('bodyMarkdown', 'Content Markdown cannot exceed 500,000 characters.');
  }

  return normalized;
}

export function normalizeRevisionNote(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\s+/gu, ' ');

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > 300) {
    throw validationError('note', 'Revision note cannot exceed 300 characters.');
  }

  return normalized;
}

export function assertContentEditable(status: ContentStatus): void {
  if (status === ContentStatus.ARCHIVED) {
    throw new DomainError({
      code: ErrorCode.ACTION_NOT_ALLOWED,
      message: 'Archived Content cannot be modified.',
    });
  }
}

export function validateReadyDraft(draft: ContentDraftSnapshot): void {
  const errors: string[] = [];

  if (normalizeContentTitle(draft.title).length < 1) {
    errors.push('A title is required.');
  }

  if (plainTextLength(draft.bodyMarkdown) < 20) {
    errors.push('Markdown body must contain at least 20 meaningful characters.');
  }

  if (errors.length > 0) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Content is not ready.',
      details: { errors },
    });
  }
}

export function renderMarkdownPreview(markdown: string): Readonly<MarkdownPreview> {
  const normalized = normalizeContentMarkdown(markdown);
  const warnings = new Set<string>();

  if (/<\/?[a-z][^>]*>/iu.test(normalized)) {
    warnings.add('raw_html_escaped');
  }

  const lines = normalized.split('\n');
  const output: string[] = [];
  let paragraph: string[] = [];
  let listOpen = false;
  let codeOpen = false;
  let codeLines: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      output.push(`<p>${renderInline(paragraph.join(' '), warnings)}</p>`);
      paragraph = [];
    }
  };

  const closeList = () => {
    if (listOpen) {
      output.push('</ul>');
      listOpen = false;
    }
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      flushParagraph();
      closeList();

      if (codeOpen) {
        output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeOpen = false;
        codeLines = [];
      } else {
        codeOpen = true;
      }
      continue;
    }

    if (codeOpen) {
      codeLines.push(line);
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

    const listItem = /^\s*[-*+]\s+(.+)$/u.exec(line);
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
  const pattern = /\[([^\]]+)]\(([^)]+)\)/gu;

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
  return escapeHtml(value)
    .replace(/`([^`]+)`/gu, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>')
    .replace(/_([^_]+)_/gu, '<em>$1</em>');
}

function normalizeSafeHref(value: string): string | undefined {
  const trimmed = value.trim();

  if (/^(https?:\/\/|mailto:)/iu.test(trimmed)) {
    return trimmed;
  }

  if (/^(\/|#)/u.test(trimmed) && !trimmed.startsWith('//')) {
    return trimmed;
  }

  return undefined;
}

function plainTextLength(markdown: string): number {
  const withoutBlocks = markdown
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/<[^>]*>/gu, ' ');
  const withoutMarkup = [
    '#',
    '>',
    '*',
    '_',
    '`',
    '~',
    '(',
    ')',
    '-',
    '[',
    ']',
  ].reduce((value, marker) => value.replaceAll(marker, ' '), withoutBlocks);

  return withoutMarkup.replace(/\s+/gu, ' ').trim().length;
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
  return escapeHtml(value).replace(/`/gu, '&#96;');
}

function validationError(field: string, message: string): DomainError {
  return new DomainError({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { field },
  });
}
