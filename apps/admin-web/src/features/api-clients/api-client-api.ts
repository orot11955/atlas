import { createAdminApiClient } from '../../lib/api';
import type {
  ApiClient,
  ApiClientCredentialResult,
  ApiClientScope,
  ApiClientStatus,
  ApiClientType,
  ApiEnvelope,
} from './api-client-types';

export interface ApiClientListInput {
  siteId?: string;
  status?: ApiClientStatus;
  type?: ApiClientType;
  search?: string;
}

export interface CreateApiClientInput {
  name: string;
  description?: string;
  type: ApiClientType;
  rateLimitPerMinute: number;
  requireOrigin: boolean;
  siteIds: readonly string[];
  scopes: readonly ApiClientScope[];
  allowedOrigins: readonly string[];
  expiresAt?: string;
}

export interface UpdateApiClientInput
  extends Omit<CreateApiClientInput, 'type' | 'expiresAt'> {
  version: number;
}

function client() {
  return createAdminApiClient();
}

export async function loadApiClients(
  input: ApiClientListInput = {},
): Promise<readonly ApiClient[]> {
  const response = await client().get<ApiEnvelope<readonly ApiClient[]>>(
    buildApiClientListPath(input),
  );
  return response.data;
}

export async function loadApiClient(apiClientId: string): Promise<ApiClient> {
  const response = await client().get<ApiEnvelope<ApiClient>>(
    `/api-clients/${encodeURIComponent(apiClientId)}`,
  );
  return response.data;
}

export async function createApiClient(
  input: CreateApiClientInput,
): Promise<ApiClientCredentialResult> {
  const response = await client().post<
    ApiEnvelope<ApiClientCredentialResult>
  >('/api-clients', compactInput(input));
  return response.data;
}

export async function updateApiClient(
  apiClientId: string,
  input: UpdateApiClientInput,
): Promise<ApiClient> {
  const response = await client().patch<ApiEnvelope<ApiClient>>(
    `/api-clients/${encodeURIComponent(apiClientId)}`,
    compactInput(input),
  );
  return response.data;
}

export async function rotateApiClientKey(
  apiClientId: string,
  input: { gracePeriodSeconds: number; expiresAt?: string },
): Promise<ApiClientCredentialResult> {
  const response = await client().post<
    ApiEnvelope<ApiClientCredentialResult>
  >(`/api-clients/${encodeURIComponent(apiClientId)}/keys/rotate`, input);
  return response.data;
}

export async function revokeApiClientKey(
  apiClientId: string,
  keyId: string,
): Promise<ApiClient> {
  const response = await client().post<ApiEnvelope<ApiClient>>(
    `/api-clients/${encodeURIComponent(apiClientId)}/keys/${encodeURIComponent(keyId)}/revoke`,
  );
  return response.data;
}

export async function changeApiClientStatus(
  apiClientId: string,
  status: ApiClientStatus,
  version: number,
): Promise<ApiClient> {
  const response = await client().post<ApiEnvelope<ApiClient>>(
    `/api-clients/${encodeURIComponent(apiClientId)}/${statusAction(status)}`,
    { version },
  );
  return response.data;
}

export function buildApiClientListPath(
  input: ApiClientListInput = {},
): string {
  const query = new URLSearchParams();

  if (input.siteId) {
    query.set('siteId', input.siteId);
  }
  if (input.status) {
    query.set('status', input.status);
  }
  if (input.type) {
    query.set('type', input.type);
  }
  if (input.search?.trim()) {
    query.set('search', input.search.trim());
  }

  const value = query.toString();
  return value ? `/api-clients?${value}` : '/api-clients';
}

export function parseAllowedOrigins(value: string): readonly string[] {
  return [...new Set(
    value
      .split(/\r?\n/u)
      .map((origin) => origin.trim())
      .filter(Boolean),
  )];
}

export function toOptionalIsoDate(value: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function compactInput<T extends CreateApiClientInput | UpdateApiClientInput>(
  input: T,
): T {
  return {
    ...input,
    description: input.description?.trim() || undefined,
    allowedOrigins: [...input.allowedOrigins],
    siteIds: [...input.siteIds],
    scopes: [...input.scopes],
  };
}

function statusAction(status: ApiClientStatus): string {
  switch (status) {
    case 'active':
      return 'enable';
    case 'disabled':
      return 'disable';
    case 'archived':
      return 'archive';
  }
}
