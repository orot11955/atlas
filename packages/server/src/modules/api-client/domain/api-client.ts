import { DomainError, ErrorCode } from '../../../core';

export const ApiClientType = {
  DELIVERY: 'delivery',
  INTEGRATION: 'integration',
} as const;

export type ApiClientType = (typeof ApiClientType)[keyof typeof ApiClientType];

export const API_CLIENT_TYPES = Object.freeze(
  Object.values(ApiClientType),
) as readonly ApiClientType[];

export const ApiClientStatus = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  DISABLED: 'disabled',
} as const;

export type ApiClientStatus = (typeof ApiClientStatus)[keyof typeof ApiClientStatus];

export const API_CLIENT_STATUSES = Object.freeze(
  Object.values(ApiClientStatus),
) as readonly ApiClientStatus[];

export const ApiClientScope = {
  CONTENT_READ: 'content:read',
  DEPLOYMENT_CREATE: 'deployment:create',
  DEPLOYMENT_UPDATE: 'deployment:update',
  FEED_READ: 'feed:read',
  HEALTH_WRITE: 'health:write',
  RELEASE_WRITE: 'release:write',
  SITE_READ: 'site:read',
} as const;

export type ApiClientScope = (typeof ApiClientScope)[keyof typeof ApiClientScope];

export const API_CLIENT_SCOPES = Object.freeze(
  Object.values(ApiClientScope),
) as readonly ApiClientScope[];

const SCOPES_BY_TYPE: Readonly<Record<ApiClientType, readonly ApiClientScope[]>> = Object.freeze({
  [ApiClientType.DELIVERY]: Object.freeze([
    ApiClientScope.SITE_READ,
    ApiClientScope.CONTENT_READ,
    ApiClientScope.FEED_READ,
  ]),
  [ApiClientType.INTEGRATION]: Object.freeze([
    ApiClientScope.RELEASE_WRITE,
    ApiClientScope.DEPLOYMENT_CREATE,
    ApiClientScope.DEPLOYMENT_UPDATE,
    ApiClientScope.HEALTH_WRITE,
  ]),
});

export const ApiClientKeyStatus = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  GRACE: 'grace',
  REVOKED: 'revoked',
} as const;

export type ApiClientKeyStatus = (typeof ApiClientKeyStatus)[keyof typeof ApiClientKeyStatus];

export interface ApiClientKeyRecord {
  id: string;
  apiClientId: string;
  keyPrefix: string;
  createdAt: Date;
  expiresAt?: Date;
  graceExpiresAt?: Date;
  replacedByKeyId?: string;
  revokedAt?: Date;
  lastUsedAt?: Date;
}

export interface ApiClientRecord {
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
  keys: readonly ApiClientKeyRecord[];
  disabledAt?: Date;
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiClientSiteContext {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  type: string;
  status: string;
  timezone: string;
  locale: string;
  canonicalHostname?: string;
}

export interface ApiClientPrincipal {
  apiClientId: string;
  apiClientKeyId: string;
  workspaceId: string;
  type: ApiClientType;
  scopes: readonly ApiClientScope[];
  site: Readonly<ApiClientSiteContext>;
}

export function getApiClientScopesForType(type: ApiClientType): readonly ApiClientScope[] {
  return SCOPES_BY_TYPE[type];
}

export function normalizeApiClientType(value: string): ApiClientType {
  if (!API_CLIENT_TYPES.includes(value as ApiClientType)) {
    throw validationError('type', 'API Client type is invalid.');
  }

  return value as ApiClientType;
}

export function normalizeApiClientName(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');

  if (normalized.length < 1 || normalized.length > 120) {
    throw validationError('name', 'API Client name must contain between 1 and 120 characters.');
  }

  return normalized;
}

export function normalizeApiClientDescription(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\s+/gu, ' ');

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > 500) {
    throw validationError('description', 'API Client description cannot exceed 500 characters.');
  }

  return normalized;
}

export function normalizeApiClientRateLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100_000) {
    throw validationError(
      'rateLimitPerMinute',
      'API Client rate limit must be between 1 and 100000 requests per minute.',
    );
  }

  return value;
}

export function normalizeApiClientScopes(
  type: ApiClientType,
  values: readonly string[],
): readonly ApiClientScope[] {
  if (values.length < 1 || values.length > API_CLIENT_SCOPES.length) {
    throw validationError('scopes', 'At least one API Client scope is required.');
  }

  const unique = [...new Set(values)];
  const allowed = SCOPES_BY_TYPE[type];

  if (
    unique.length !== values.length ||
    unique.some((value) => !allowed.includes(value as ApiClientScope))
  ) {
    throw validationError('scopes', `API Client scopes are invalid for the ${type} client type.`);
  }

  return Object.freeze([...unique].sort()) as readonly ApiClientScope[];
}

export function normalizeApiClientSiteIds(values: readonly string[]): readonly string[] {
  if (values.length < 1 || values.length > 100) {
    throw validationError('siteIds', 'API Client must have access to between 1 and 100 Sites.');
  }

  const unique = [...new Set(values)];

  if (unique.length !== values.length || unique.some((value) => !isUuidV7(value))) {
    throw validationError('siteIds', 'API Client Site identifiers are invalid.');
  }

  return Object.freeze([...unique].sort());
}

export function normalizeApiClientAllowedOrigins(
  values: readonly string[],
  requireOrigin: boolean,
): readonly string[] {
  if (values.length > 20) {
    throw validationError(
      'allowedOrigins',
      'API Client cannot contain more than 20 allowed Origins.',
    );
  }

  const normalized = values.map(normalizeAllowedOrigin);
  const unique = [...new Set(normalized)].sort();

  if (unique.length !== normalized.length) {
    throw validationError('allowedOrigins', 'API Client allowed Origins must be unique.');
  }

  if (requireOrigin && unique.length === 0) {
    throw validationError(
      'allowedOrigins',
      'At least one allowed Origin is required when Origin enforcement is enabled.',
    );
  }

  return Object.freeze(unique);
}

export function normalizeAllowedOrigin(value: string): string {
  const normalized = value.trim();
  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    throw validationError('allowedOrigins', 'Allowed Origin is invalid.');
  }

  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw validationError(
      'allowedOrigins',
      'Allowed Origin must contain only an HTTP or HTTPS origin.',
    );
  }

  return parsed.origin;
}

export function normalizeApiClientKeyExpiration(
  value: Date | undefined,
  now: Date,
): Date | undefined {
  if (!value) {
    return undefined;
  }

  const expiresAt = new Date(value);
  const minimum = now.getTime() + 60_000;
  const maximum = now.getTime() + 2 * 365 * 24 * 60 * 60 * 1_000;

  if (
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt.getTime() < minimum ||
    expiresAt.getTime() > maximum
  ) {
    throw validationError(
      'expiresAt',
      'API Key expiration must be between one minute and two years in the future.',
    );
  }

  return expiresAt;
}

export function normalizeApiClientGracePeriodSeconds(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 604_800) {
    throw validationError(
      'gracePeriodSeconds',
      'API Key grace period must be between 0 and 604800 seconds.',
    );
  }

  return value;
}

export function resolveApiClientKeyStatus(key: ApiClientKeyRecord, now: Date): ApiClientKeyStatus {
  if (key.revokedAt) {
    return ApiClientKeyStatus.REVOKED;
  }

  if (key.expiresAt && key.expiresAt.getTime() <= now.getTime()) {
    return ApiClientKeyStatus.EXPIRED;
  }

  if (key.replacedByKeyId) {
    return key.graceExpiresAt && key.graceExpiresAt.getTime() > now.getTime()
      ? ApiClientKeyStatus.GRACE
      : ApiClientKeyStatus.EXPIRED;
  }

  return ApiClientKeyStatus.ACTIVE;
}

export function isApiClientKeyUsable(key: ApiClientKeyRecord, now: Date): boolean {
  const status = resolveApiClientKeyStatus(key, now);
  return status === ApiClientKeyStatus.ACTIVE || status === ApiClientKeyStatus.GRACE;
}

export function assertApiClientMutable(status: ApiClientStatus): void {
  if (status === ApiClientStatus.ARCHIVED) {
    throw new DomainError({
      code: ErrorCode.ACTION_NOT_ALLOWED,
      message: 'Archived API Clients cannot be modified.',
    });
  }
}

export function assertApiClientStatusTransition(
  current: ApiClientStatus,
  target: ApiClientStatus,
): void {
  if (current === target) {
    return;
  }

  const allowed: Readonly<Record<ApiClientStatus, readonly ApiClientStatus[]>> = {
    [ApiClientStatus.ACTIVE]: [ApiClientStatus.DISABLED, ApiClientStatus.ARCHIVED],
    [ApiClientStatus.DISABLED]: [ApiClientStatus.ACTIVE, ApiClientStatus.ARCHIVED],
    [ApiClientStatus.ARCHIVED]: [],
  };

  if (!allowed[current].includes(target)) {
    throw new DomainError({
      code: ErrorCode.INVALID_STATE_TRANSITION,
      message: `API Client status cannot change from ${current} to ${target}.`,
      details: { current, target },
    });
  }
}

export function createApiClientAuthenticationError(): DomainError {
  return new DomainError({
    code: ErrorCode.AUTH_REQUIRED,
    message: 'A valid API Key is required.',
  });
}

export function createApiClientForbiddenError(message: string): DomainError {
  return new DomainError({
    code: ErrorCode.FORBIDDEN,
    message,
  });
}

function isUuidV7(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function validationError(field: string, message: string): DomainError {
  return new DomainError({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { field },
  });
}
