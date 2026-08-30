import type { AuditService, Clock, TransactionRunner } from '../../../core';
import { AuditResult, DomainError, ErrorCode, createUuidV7, systemClock } from '../../../core';
import {
  ApiClientStatus,
  assertApiClientMutable,
  assertApiClientStatusTransition,
  normalizeApiClientAllowedOrigins,
  normalizeApiClientDescription,
  normalizeApiClientGracePeriodSeconds,
  normalizeApiClientKeyExpiration,
  normalizeApiClientName,
  normalizeApiClientRateLimit,
  normalizeApiClientScopes,
  normalizeApiClientSiteIds,
  normalizeApiClientType,
  type ApiClientKeyRecord,
  type ApiClientRecord,
  type ApiClientScope,
  type ApiClientStatus as ApiClientStatusType,
  type ApiClientType,
} from '../domain/api-client';
import type { ApiClientKeyIssuerPort } from '../ports/api-client-key-issuer.port';
import type {
  ApiClientListQuery,
  ApiClientRepositoryPort,
  StoredApiClientKey,
} from '../ports/api-client.repository';

export interface CreateApiClientInput {
  name: string;
  description?: string;
  type: string;
  rateLimitPerMinute: number;
  requireOrigin: boolean;
  siteIds: readonly string[];
  scopes: readonly string[];
  allowedOrigins: readonly string[];
  expiresAt?: Date;
}

export interface UpdateApiClientInput {
  version: number;
  name: string;
  description?: string;
  rateLimitPerMinute: number;
  requireOrigin: boolean;
  siteIds: readonly string[];
  scopes: readonly string[];
  allowedOrigins: readonly string[];
}

export interface RotateApiClientKeyInput {
  gracePeriodSeconds: number;
  expiresAt?: Date;
}

export interface ApiClientCredential {
  keyId: string;
  keyPrefix: string;
  apiKey: string;
  createdAt: Date;
  expiresAt?: Date;
  previousKeyGraceExpiresAt?: Date;
}

export interface ApiClientCredentialResult {
  client: Readonly<ApiClientRecord>;
  credential: Readonly<ApiClientCredential>;
}

export class ApiClientAdministrationService<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: ApiClientRepositoryPort<TTransaction>,
    private readonly keyIssuer: ApiClientKeyIssuerPort,
    private readonly auditService: AuditService<TTransaction>,
    private readonly clock: Clock = systemClock,
  ) {}

  public listClients(
    workspaceId: string,
    query: ApiClientListQuery = {},
  ): Promise<readonly ApiClientRecord[]> {
    return this.repository.list(workspaceId, normalizeListQuery(query));
  }

  public async getClient(
    workspaceId: string,
    apiClientId: string,
  ): Promise<Readonly<ApiClientRecord>> {
    const client = await this.repository.findById(workspaceId, apiClientId);

    if (!client) {
      throw apiClientNotFoundError();
    }

    return Object.freeze(client);
  }

  public async createClient(
    workspaceId: string,
    input: CreateApiClientInput,
  ): Promise<Readonly<ApiClientCredentialResult>> {
    const type = normalizeApiClientType(input.type);
    const name = normalizeApiClientName(input.name);
    const description = normalizeApiClientDescription(input.description);
    const rateLimitPerMinute = normalizeApiClientRateLimit(input.rateLimitPerMinute);
    const siteIds = normalizeApiClientSiteIds(input.siteIds);
    const scopes = normalizeApiClientScopes(type, input.scopes);
    const allowedOrigins = normalizeApiClientAllowedOrigins(
      input.allowedOrigins,
      input.requireOrigin,
    );
    const now = this.clock.now();
    const expiresAt = normalizeApiClientKeyExpiration(input.expiresAt, now);
    const id = createUuidV7(now.getTime());
    const issued = this.keyIssuer.issue(now);
    const key = createStoredKey(id, issued, now, expiresAt);
    const client: ApiClientRecord = {
      id,
      workspaceId,
      name,
      description,
      type,
      status: ApiClientStatus.ACTIVE,
      rateLimitPerMinute,
      requireOrigin: input.requireOrigin,
      version: 1,
      siteIds,
      scopes,
      allowedOrigins,
      keys: [toPublicKey(key)],
      createdAt: now,
      updatedAt: now,
    };

    await this.transactionRunner.run(async (transaction) => {
      await this.assertSitesExist(workspaceId, siteIds, transaction);
      await this.repository.insert({ client, initialKey: key }, transaction);
      await this.auditService.record(
        {
          action: 'api-client.created',
          targetType: 'api-client',
          targetId: id,
          result: AuditResult.SUCCESS,
          metadata: {
            type,
            siteCount: siteIds.length,
            scopes,
            allowedOriginCount: allowedOrigins.length,
            requireOrigin: input.requireOrigin,
            rateLimitPerMinute,
            keyId: issued.id,
            keyPrefix: issued.keyPrefix,
            expiresAt,
          },
        },
        transaction,
      );
    });

    return Object.freeze({
      client: Object.freeze(client),
      credential: Object.freeze({
        keyId: issued.id,
        keyPrefix: issued.keyPrefix,
        apiKey: issued.apiKey,
        createdAt: now,
        expiresAt,
      }),
    });
  }

  public async updateClient(
    workspaceId: string,
    apiClientId: string,
    input: UpdateApiClientInput,
  ): Promise<Readonly<ApiClientRecord>> {
    assertPositiveVersion(input.version);
    const now = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findById(workspaceId, apiClientId, transaction);

      if (!current) {
        throw apiClientNotFoundError();
      }

      assertApiClientMutable(current.status);
      const name = normalizeApiClientName(input.name);
      const description = normalizeApiClientDescription(input.description);
      const rateLimitPerMinute = normalizeApiClientRateLimit(input.rateLimitPerMinute);
      const siteIds = normalizeApiClientSiteIds(input.siteIds);
      const scopes = normalizeApiClientScopes(current.type, input.scopes);
      const allowedOrigins = normalizeApiClientAllowedOrigins(
        input.allowedOrigins,
        input.requireOrigin,
      );

      await this.assertSitesExist(workspaceId, siteIds, transaction);
      const updated = await this.repository.updateConfiguration(
        workspaceId,
        apiClientId,
        {
          name,
          description,
          rateLimitPerMinute,
          requireOrigin: input.requireOrigin,
          siteIds,
          scopes,
          allowedOrigins,
          expectedVersion: input.version,
          nextVersion: input.version + 1,
          updatedAt: now,
        },
        transaction,
      );

      if (!updated) {
        throw versionConflictError();
      }

      await this.auditService.record(
        {
          action: 'api-client.updated',
          targetType: 'api-client',
          targetId: apiClientId,
          result: AuditResult.SUCCESS,
          metadata: {
            changedFields: [
              'name',
              'description',
              'rateLimitPerMinute',
              'requireOrigin',
              'siteIds',
              'scopes',
              'allowedOrigins',
            ],
            version: input.version + 1,
          },
        },
        transaction,
      );

      return Object.freeze({
        ...current,
        name,
        description,
        rateLimitPerMinute,
        requireOrigin: input.requireOrigin,
        siteIds,
        scopes,
        allowedOrigins,
        version: input.version + 1,
        updatedAt: now,
      });
    });
  }

  public async rotateKey(
    workspaceId: string,
    apiClientId: string,
    input: RotateApiClientKeyInput,
  ): Promise<Readonly<ApiClientCredentialResult>> {
    const now = this.clock.now();
    const gracePeriodSeconds = normalizeApiClientGracePeriodSeconds(input.gracePeriodSeconds);
    const expiresAt = normalizeApiClientKeyExpiration(input.expiresAt, now);
    const issued = this.keyIssuer.issue(now);
    const key = createStoredKey(apiClientId, issued, now, expiresAt);

    const client = await this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findById(workspaceId, apiClientId, transaction);

      if (!current) {
        throw apiClientNotFoundError();
      }

      assertApiClientMutable(current.status);
      const previousKey = await this.repository.findCurrentKeyForUpdate(apiClientId, transaction);
      const graceExpiresAt = previousKey
        ? new Date(now.getTime() + gracePeriodSeconds * 1_000)
        : undefined;

      if (previousKey && graceExpiresAt) {
        await this.repository.markKeyReplaced(
          previousKey.id,
          issued.id,
          graceExpiresAt,
          transaction,
        );
      }

      await this.repository.insertKey(key, transaction);
      await this.auditService.record(
        {
          action: 'api-client.key-rotated',
          targetType: 'api-client',
          targetId: apiClientId,
          result: AuditResult.SUCCESS,
          metadata: {
            keyId: issued.id,
            keyPrefix: issued.keyPrefix,
            previousKeyId: previousKey?.id,
            graceExpiresAt,
            expiresAt,
          },
        },
        transaction,
      );

      const refreshed = await this.repository.findById(workspaceId, apiClientId, transaction);

      if (!refreshed) {
        throw apiClientNotFoundError();
      }

      return { refreshed, graceExpiresAt };
    });

    return Object.freeze({
      client: Object.freeze(client.refreshed),
      credential: Object.freeze({
        keyId: issued.id,
        keyPrefix: issued.keyPrefix,
        apiKey: issued.apiKey,
        createdAt: now,
        expiresAt,
        previousKeyGraceExpiresAt: client.graceExpiresAt,
      }),
    });
  }

  public async revokeKey(
    workspaceId: string,
    apiClientId: string,
    keyId: string,
  ): Promise<Readonly<ApiClientRecord>> {
    const now = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findById(workspaceId, apiClientId, transaction);

      if (!current) {
        throw apiClientNotFoundError();
      }

      assertApiClientMutable(current.status);
      const key = await this.repository.findKeyForUpdate(apiClientId, keyId, transaction);

      if (!key) {
        throw apiClientKeyNotFoundError();
      }

      if (!key.revokedAt) {
        await this.repository.revokeKey(key.id, now, transaction);
        await this.auditService.record(
          {
            action: 'api-client.key-revoked',
            targetType: 'api-client-key',
            targetId: key.id,
            result: AuditResult.SUCCESS,
            metadata: {
              apiClientId,
              keyPrefix: key.keyPrefix,
            },
          },
          transaction,
        );
      }

      const refreshed = await this.repository.findById(workspaceId, apiClientId, transaction);

      if (!refreshed) {
        throw apiClientNotFoundError();
      }

      return Object.freeze(refreshed);
    });
  }

  public async changeStatus(
    workspaceId: string,
    apiClientId: string,
    target: ApiClientStatusType,
    version: number,
  ): Promise<Readonly<ApiClientRecord>> {
    assertPositiveVersion(version);
    const now = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findById(workspaceId, apiClientId, transaction);

      if (!current) {
        throw apiClientNotFoundError();
      }

      assertApiClientStatusTransition(current.status, target);

      if (current.status === target) {
        return Object.freeze(current);
      }

      const disabledAt =
        target === ApiClientStatus.DISABLED
          ? now
          : target === ApiClientStatus.ACTIVE
            ? undefined
            : current.disabledAt;
      const archivedAt = target === ApiClientStatus.ARCHIVED ? now : undefined;
      const updated = await this.repository.updateStatus(
        workspaceId,
        apiClientId,
        {
          status: target,
          disabledAt,
          archivedAt,
          expectedVersion: version,
          nextVersion: version + 1,
          updatedAt: now,
        },
        transaction,
      );

      if (!updated) {
        throw versionConflictError();
      }

      if (target === ApiClientStatus.ARCHIVED) {
        await this.repository.revokeAllOpenKeys(apiClientId, now, transaction);
      }

      await this.auditService.record(
        {
          action: 'api-client.status-changed',
          targetType: 'api-client',
          targetId: apiClientId,
          result: AuditResult.SUCCESS,
          metadata: {
            previousStatus: current.status,
            status: target,
            version: version + 1,
          },
        },
        transaction,
      );

      const refreshed = await this.repository.findById(workspaceId, apiClientId, transaction);

      if (!refreshed) {
        throw apiClientNotFoundError();
      }

      return Object.freeze(refreshed);
    });
  }

  private async assertSitesExist(
    workspaceId: string,
    siteIds: readonly string[],
    transaction: TTransaction,
  ): Promise<void> {
    const existing = await this.repository.findExistingSiteIds(workspaceId, siteIds, transaction);

    if (existing.length !== siteIds.length) {
      throw new DomainError({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'One or more API Client Sites do not exist in the Workspace.',
        details: { field: 'siteIds' },
      });
    }
  }
}

function createStoredKey(
  apiClientId: string,
  issued: Readonly<{
    id: string;
    keyPrefix: string;
    secretDigest: string;
  }>,
  createdAt: Date,
  expiresAt?: Date,
): StoredApiClientKey {
  return {
    id: issued.id,
    apiClientId,
    keyPrefix: issued.keyPrefix,
    secretDigest: issued.secretDigest,
    createdAt,
    expiresAt,
  };
}

function toPublicKey(key: StoredApiClientKey): ApiClientKeyRecord {
  const { secretDigest: _secretDigest, ...publicKey } = key;
  return publicKey;
}

function normalizeListQuery(query: ApiClientListQuery): ApiClientListQuery {
  const search = query.search?.trim().replace(/\s+/gu, ' ');

  if (search && search.length > 120) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'API Client search query is too long.',
      details: { field: 'search' },
    });
  }

  return {
    siteId: query.siteId,
    status: query.status,
    type: query.type,
    search: search || undefined,
  };
}

function assertPositiveVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'API Client version is invalid.',
      details: { field: 'version' },
    });
  }
}

function apiClientNotFoundError(): DomainError {
  return new DomainError({
    code: ErrorCode.API_CLIENT_NOT_FOUND,
    message: 'API Client was not found.',
  });
}

function apiClientKeyNotFoundError(): DomainError {
  return new DomainError({
    code: ErrorCode.API_CLIENT_KEY_NOT_FOUND,
    message: 'API Client Key was not found.',
  });
}

function versionConflictError(): DomainError {
  return new DomainError({
    code: ErrorCode.VERSION_CONFLICT,
    message: 'API Client was changed by another request.',
  });
}
