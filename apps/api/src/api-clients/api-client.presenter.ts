import {
  resolveApiClientKeyStatus,
  type ApiClientCredential,
  type ApiClientRecord,
} from '@atlas/server';

export function toApiClientData(client: Readonly<ApiClientRecord>, now: Date) {
  return {
    id: client.id,
    workspaceId: client.workspaceId,
    name: client.name,
    ...(client.description ? { description: client.description } : {}),
    type: client.type,
    status: client.status,
    rateLimitPerMinute: client.rateLimitPerMinute,
    requireOrigin: client.requireOrigin,
    version: client.version,
    siteIds: client.siteIds,
    scopes: client.scopes,
    allowedOrigins: client.allowedOrigins,
    keys: client.keys.map((key) => ({
      id: key.id,
      keyPrefix: key.keyPrefix,
      status: resolveApiClientKeyStatus(key, now),
      createdAt: key.createdAt.toISOString(),
      ...(key.expiresAt ? { expiresAt: key.expiresAt.toISOString() } : {}),
      ...(key.graceExpiresAt ? { graceExpiresAt: key.graceExpiresAt.toISOString() } : {}),
      ...(key.replacedByKeyId ? { replacedByKeyId: key.replacedByKeyId } : {}),
      ...(key.revokedAt ? { revokedAt: key.revokedAt.toISOString() } : {}),
      ...(key.lastUsedAt ? { lastUsedAt: key.lastUsedAt.toISOString() } : {}),
    })),
    ...(client.disabledAt ? { disabledAt: client.disabledAt.toISOString() } : {}),
    ...(client.archivedAt ? { archivedAt: client.archivedAt.toISOString() } : {}),
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
  };
}

export function toApiClientCredentialData(credential: Readonly<ApiClientCredential>) {
  return {
    keyId: credential.keyId,
    keyPrefix: credential.keyPrefix,
    apiKey: credential.apiKey,
    createdAt: credential.createdAt.toISOString(),
    ...(credential.expiresAt ? { expiresAt: credential.expiresAt.toISOString() } : {}),
    ...(credential.previousKeyGraceExpiresAt
      ? {
          previousKeyGraceExpiresAt: credential.previousKeyGraceExpiresAt.toISOString(),
        }
      : {}),
  };
}
