import { createAdminApiClient } from '../../lib/api';
import type {
  ApiEnvelope,
  Content,
  ContentListResult,
  ContentRevision,
  ContentStatus,
  ContentType,
} from './content-types';

function client() {
  return createAdminApiClient();
}

export async function loadContents(input: {
  limit?: number;
  cursor?: string;
  search?: string;
  status?: ContentStatus;
  type?: ContentType;
} = {}): Promise<ContentListResult> {
  const query = new URLSearchParams();

  if (input.limit !== undefined) query.set('limit', String(input.limit));
  if (input.cursor) query.set('cursor', input.cursor);
  if (input.search?.trim()) query.set('search', input.search.trim());
  if (input.status) query.set('status', input.status);
  if (input.type) query.set('type', input.type);

  const suffix = query.toString();
  const response = await client().get<ApiEnvelope<Content>>(
    `/contents${suffix ? `?${suffix}` : ''}`,
  );
  return response.data as unknown as ContentListResult;
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

export async function previewContent(input: {
  title?: string;
  summary?: string;
  bodyMarkdown: string;
}): Promise<{ html: string; warnings: readonly string[] }> {
  const response = await client().post<
    ApiEnvelope<{ html: string; warnings: readonly string[] }>
  >('/contents/preview'.replace('/contents/preview', '/contents/placeholder/preview'), input);
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
