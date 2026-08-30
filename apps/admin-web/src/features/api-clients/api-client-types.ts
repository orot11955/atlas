export type ApiClientType = 'delivery' | 'integration';
export type ApiClientStatus = 'active' | 'disabled' | 'archived';
export type ApiClientScope =
  | 'site:read'
  | 'content:read'
  | 'feed:read'
  | 'release:write'
  | 'deployment:create'
  | 'deployment:update'
  | 'health:write';
export type ApiClientKeyStatus = 'active' | 'grace' | 'expired' | 'revoked';

export interface ApiClientKey {
  id: string;
  keyPrefix: string;
  status: ApiClientKeyStatus;
  createdAt: string;
  expiresAt?: string;
  graceExpiresAt?: string;
  replacedByKeyId?: string;
  revokedAt?: string;
  lastUsedAt?: string;
}

export interface ApiClient {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  type: ApiClientType;
  status: ApiClientStatus;
  rateLimitPerMinute: number;
  requireOrigin: boolean;
  version: number;
  siteIds: readonly string[];
  scopes: readonly ApiClientScope[];
  allowedOrigins: readonly string[];
  keys: readonly ApiClientKey[];
  disabledAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiClientCredential {
  keyId: string;
  keyPrefix: string;
  apiKey: string;
  createdAt: string;
  expiresAt?: string;
  previousKeyGraceExpiresAt?: string;
}

export interface ApiClientCredentialResult {
  client: ApiClient;
  credential: ApiClientCredential;
}

export interface ApiEnvelope<T> {
  data: T;
}

export const API_CLIENT_TYPE_OPTIONS: readonly Readonly<{
  value: ApiClientType;
  label: string;
}>[] = Object.freeze([
  { value: 'delivery', label: 'Delivery' },
  { value: 'integration', label: 'Integration' },
]);

export const API_CLIENT_STATUS_OPTIONS: readonly Readonly<{
  value: ApiClientStatus;
  label: string;
}>[] = Object.freeze([
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'archived', label: 'Archived' },
]);

export const API_CLIENT_SCOPE_OPTIONS: readonly Readonly<{
  value: ApiClientScope;
  label: string;
  types: readonly ApiClientType[];
}>[] = Object.freeze([
  { value: 'site:read', label: 'Site 조회', types: ['delivery'] },
  { value: 'content:read', label: '콘텐츠 조회', types: ['delivery'] },
  { value: 'feed:read', label: 'Feed 조회', types: ['delivery'] },
  { value: 'release:write', label: 'Release 기록', types: ['integration'] },
  {
    value: 'deployment:create',
    label: 'Deployment 생성',
    types: ['integration'],
  },
  {
    value: 'deployment:update',
    label: 'Deployment 갱신',
    types: ['integration'],
  },
  { value: 'health:write', label: 'Health 결과 기록', types: ['integration'] },
]);

const STATUS_TRANSITIONS = {
  active: ['disabled', 'archived'],
  disabled: ['active', 'archived'],
  archived: [],
} as const satisfies Readonly<
  Record<ApiClientStatus, readonly ApiClientStatus[]>
>;

export function getApiClientScopes(
  type: ApiClientType,
): readonly ApiClientScope[] {
  return API_CLIENT_SCOPE_OPTIONS.filter((option) =>
    option.types.includes(type),
  ).map((option) => option.value);
}

export function getApiClientStatusTransitions(
  status: ApiClientStatus,
): readonly ApiClientStatus[] {
  return STATUS_TRANSITIONS[status];
}

export function apiClientStatusLabel(status: ApiClientStatus): string {
  return (
    API_CLIENT_STATUS_OPTIONS.find((option) => option.value === status)?.label ??
    status
  );
}

export function apiClientTypeLabel(type: ApiClientType): string {
  return (
    API_CLIENT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type
  );
}

export function apiClientKeyStatusLabel(status: ApiClientKeyStatus): string {
  switch (status) {
    case 'active':
      return '현재';
    case 'grace':
      return '유예';
    case 'expired':
      return '만료';
    case 'revoked':
      return '폐기';
  }
}
