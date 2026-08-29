import { createAdminApiClient } from '../../lib/api';
import type {
  ApiEnvelope,
  Site,
  SiteListResult,
  SiteStatus,
  SiteType,
  Workspace,
} from './site-types';

export interface SiteListInput {
  cursor?: string;
  limit?: number;
  search?: string;
  status?: SiteStatus;
  type?: SiteType;
}

export interface CreateSiteInput {
  key: string;
  name: string;
  description?: string;
  type: SiteType;
  timezone: string;
  locale: string;
  canonicalDomain?: string;
}

export interface UpdateSiteInput extends Omit<CreateSiteInput, 'key'> {
  version: number;
}

function client() {
  return createAdminApiClient();
}

export async function loadWorkspace(): Promise<Workspace> {
  const response = await client().get<ApiEnvelope<Workspace>>('/workspace');
  return response.data;
}

export async function updateWorkspace(input: {
  version: number;
  name: string;
  timezone: string;
  locale: string;
}): Promise<Workspace> {
  const response = await client().patch<ApiEnvelope<Workspace>>('/workspace', input);
  return response.data;
}

export async function loadSites(input: SiteListInput = {}): Promise<SiteListResult> {
  const response = await client().get<ApiEnvelope<SiteListResult>>(buildSiteListPath(input));
  return response.data;
}

export async function loadSite(siteId: string): Promise<Site> {
  const response = await client().get<ApiEnvelope<Site>>(
    `/sites/${encodeURIComponent(siteId)}`,
  );
  return response.data;
}

export async function createSite(input: CreateSiteInput): Promise<Site> {
  const response = await client().post<ApiEnvelope<Site>>('/sites', compactSiteInput(input));
  return response.data;
}

export async function updateSite(siteId: string, input: UpdateSiteInput): Promise<Site> {
  const response = await client().patch<ApiEnvelope<Site>>(
    `/sites/${encodeURIComponent(siteId)}`,
    compactSiteInput(input),
  );
  return response.data;
}

export async function changeSiteStatus(
  siteId: string,
  status: SiteStatus,
  version: number,
): Promise<Site> {
  const action = statusToAction(status);
  const response = await client().post<ApiEnvelope<Site>>(
    `/sites/${encodeURIComponent(siteId)}/${action}`,
    { version },
  );
  return response.data;
}

export function buildSiteListPath(input: SiteListInput = {}): string {
  const query = new URLSearchParams();

  if (input.cursor) {
    query.set('cursor', input.cursor);
  }
  if (input.limit !== undefined) {
    query.set('limit', String(input.limit));
  }
  if (input.search?.trim()) {
    query.set('search', input.search.trim());
  }
  if (input.status) {
    query.set('status', input.status);
  }
  if (input.type) {
    query.set('type', input.type);
  }

  const value = query.toString();
  return value ? `/sites?${value}` : '/sites';
}

function compactSiteInput<T extends CreateSiteInput | UpdateSiteInput>(input: T): T {
  return {
    ...input,
    description: input.description?.trim() || undefined,
    canonicalDomain: input.canonicalDomain?.trim() || undefined,
  };
}

function statusToAction(status: SiteStatus): string {
  switch (status) {
    case 'active':
      return 'activate';
    case 'maintenance':
      return 'maintenance';
    case 'disabled':
      return 'disable';
    case 'archived':
      return 'archive';
    case 'draft':
      throw new TypeError('Site cannot transition back to draft.');
  }
}
