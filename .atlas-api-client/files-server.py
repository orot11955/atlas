FILES = {
    'packages/server/src/modules/api-client/domain/api-client.ts': r'''import { DomainError, ErrorCode } from '../../../core';
import type { SiteStatus } from '../../site';

export const ApiClientStatus = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
  REVOKED: 'revoked',
} as const;

export type ApiClientStatus =
  (typeof ApiClientStatus)[keyof typeof ApiClientStatus];

export const API_CLIENT_STATUSES = Object.freeze(
  Object.values(ApiClientStatus),
) as readonly ApiClientStatus[];

export const ApiClientKeyStatus = {
  ACTIVE: 'active',
  GRACE: 'grace',
  REVOKED: 'revoked',
} as const;

export type ApiClientKeyStatus =
  (typeof ApiClientKeyStatus)[keyof typeof ApiClientKeyStatus];

export const ApiClientScope = {
  CONTENT_READ: 'content:read',
  FEED_READ: 'feed:read',
  SITE_READ: 'site:read',
} as const;

export type ApiClientScope =
  (typeof ApiClientScope)[keyof typeof ApiClientScope];

export const API_CLIENT_SCOPES = Object.freeze(
  Object.values(ApiClientScope),
) as readonly ApiClientScope[];

export interface ApiClientRecord {
  id: string;
  workspaceId: string;
  siteId: string;
  name: string;
  status: ApiClientStatus;
  allowedOrigins: readonly string[];
  rateLimitPerMinute: number;
  version: number;
  lastUsedAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiClientKeyRecord {
  id: string;
  apiClientId: string;
  keyPrefix: string;
  secretDigest: string;
  status: ApiClientKeyStatus;
  notBefore: Date;
  expiresAt?: Date;
  graceExpiresAt?: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
}

export interface ApiClientAggregate extends ApiClientRecord {
  scopes: readonly ApiClientScope[];
  keys: readonly ApiClientKeyRecord[];
}

export interface ApiClientAuthenticationRecord {
  client: ApiClientRecord;
  key: ApiClientKeyRecord;
  scopes: readonly ApiClientScope[];
  site: {
    id: string;
    key: string;
    name: string;
    status: SiteStatus;
  };
}

export interface IssuedApiClientSecret {
  id: string;
  token: string;
  keyPrefix: string;
  secretDigest: string;
  createdAt: Date;
}

export function normalizeApiClientName(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');

  if (normalized.length < 2 || normalized.length > 120) {
    throw validationError(
      'name',
      'API Client name must contain between 2 and 120 characters.',
    );
  }

  return normalized;
}

export function normalizeApiClientScopes(
  values: readonly string[],
): readonly ApiClientScope[] {
  const unique = [...new Set(values.map((value) => value.trim()))];

  if (unique.length < 1 || unique.length > API_CLIENT_SCOPES.length) {
    throw validationError('scopes', 'At least one API Client scope is required.');
  }

  for (const scope of unique) {
    if (!API_CLIENT_SCOPES.includes(scope as ApiClientScope)) {
      throw validationError('scopes', `Unsupported API Client scope: ${scope}.`);
    }
  }

  return Object.freeze(unique.sort() as ApiClientScope[]);
}

export function normalizeAllowedOrigins(
  values: readonly string[],
): readonly string[] {
  if (values.length > 20) {
    throw validationError('allowedOrigins', 'At most 20 allowed Origins can be configured.');
  }

  const normalized = new Set<string>();

  for (const value of values) {
    const trimmed = value.trim();

    if (!trimmed) {
      continue;
    }

    let url: URL;

    try {
      url = new URL(trimmed);
    } catch {
      throw validationError('allowedOrigins', `Invalid Origin: ${trimmed}.`);
    }

    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.origin === 'null'
    ) {
      throw validationError(
        'allowedOrigins',
        `Allowed Origin must contain only scheme, host and optional port: ${trimmed}.`,
      );
    }

    normalized.add(url.origin);
  }

  return Object.freeze([...normalized].sort());
}

export function normalizeRateLimitPerMinute(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw validationError(
      'rateLimitPerMinute',
      'API Client rate limit must be between 1 and 10,000 requests per minute.',
    );
  }

  return value;
}

export function normalizeApiClientKeyExpiration(
  value: Date | undefined,
  now: Date,
): Date | undefined {
  if (!value) {
    return undefined;
  }

  if (Number.isNaN(value.getTime()) || value.getTime() <= now.getTime()) {
    throw validationError('expiresAt', 'API Client Key expiration must be in the future.');
  }

  return new Date(value);
}

export function assertApiClientMutable(status: ApiClientStatus): void {
  if (status === ApiClientStatus.REVOKED) {
    throw new DomainError({
      code: ErrorCode.ACTION_NOT_ALLOWED,
      message: 'Revoked API Clients cannot be changed.',
    });
  }
}

export function isApiClientKeyUsable(
  key: ApiClientKeyRecord,
  now: Date,
): boolean {
  if (key.revokedAt || key.status === ApiClientKeyStatus.REVOKED) {
    return false;
  }

  if (key.notBefore.getTime() > now.getTime()) {
    return false;
  }

  if (key.expiresAt && key.expiresAt.getTime() <= now.getTime()) {
    return false;
  }

  if (
    key.status === ApiClientKeyStatus.GRACE &&
    (!key.graceExpiresAt || key.graceExpiresAt.getTime() <= now.getTime())
  ) {
    return false;
  }

  return key.status === ApiClientKeyStatus.ACTIVE || key.status === ApiClientKeyStatus.GRACE;
}

function validationError(field: string, message: string): DomainError {
  return new DomainError({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { field },
  });
}
''',
    'packages/server/src/modules/api-client/ports/api-client-token-issuer.port.ts': r'''import type { IssuedApiClientSecret } from '../domain/api-client';

export interface ParsedApiClientToken {
  keyId: string;
  secret: string;
}

export interface ApiClientTokenIssuerPort {
  issue(issuedAt: Date): Readonly<IssuedApiClientSecret>;
  parse(token: string): Readonly<ParsedApiClientToken> | undefined;
  digestSecret(secret: string): string;
  matchesSecret(secret: string, expectedDigest: string): boolean;
}
''',
    'packages/server/src/modules/api-client/ports/api-client-rate-limiter.port.ts': r'''export interface ApiClientRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface ApiClientRateLimiterPort {
  consume(
    key: string,
    limit: number,
    now: Date,
  ): Promise<Readonly<ApiClientRateLimitResult>>;
}
''',
    'packages/server/src/modules/api-client/ports/api-client.repository.ts': r'''import type {
  ApiClientAggregate,
  ApiClientAuthenticationRecord,
  ApiClientKeyRecord,
  ApiClientRecord,
  ApiClientScope,
  ApiClientStatus,
} from '../domain/api-client';

export interface InsertApiClientRecordInput extends ApiClientRecord {
  scopes: readonly ApiClientScope[];
  initialKey: ApiClientKeyRecord;
}

export interface UpdateApiClientRecordInput {
  name: string;
  allowedOrigins: readonly string[];
  rateLimitPerMinute: number;
  scopes: readonly ApiClientScope[];
  expectedVersion: number;
  nextVersion: number;
  updatedAt: Date;
}

export interface UpdateApiClientStatusInput {
  status: ApiClientStatus;
  expectedVersion: number;
  nextVersion: number;
  updatedAt: Date;
  revokedAt?: Date;
}

export interface ApiClientRepositoryPort<TTransaction = unknown> {
  listBySite(
    workspaceId: string,
    siteId: string,
  ): Promise<readonly ApiClientAggregate[]>;
  findById(
    workspaceId: string,
    siteId: string,
    clientId: string,
    transaction?: TTransaction,
  ): Promise<ApiClientAggregate | undefined>;
  findNameOwner(
    workspaceId: string,
    siteId: string,
    name: string,
    transaction?: TTransaction,
  ): Promise<string | undefined>;
  insert(
    client: InsertApiClientRecordInput,
    transaction: TTransaction,
  ): Promise<void>;
  update(
    workspaceId: string,
    siteId: string,
    clientId: string,
    input: UpdateApiClientRecordInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  updateStatus(
    workspaceId: string,
    siteId: string,
    clientId: string,
    input: UpdateApiClientStatusInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  transitionActiveKeys(
    clientId: string,
    rotatedAt: Date,
    graceExpiresAt: Date | undefined,
    transaction: TTransaction,
  ): Promise<void>;
  insertKey(key: ApiClientKeyRecord, transaction: TTransaction): Promise<void>;
  findKeyForClient(
    workspaceId: string,
    siteId: string,
    clientId: string,
    keyId: string,
    transaction?: TTransaction,
  ): Promise<ApiClientKeyRecord | undefined>;
  revokeKey(
    keyId: string,
    revokedAt: Date,
    transaction: TTransaction,
  ): Promise<boolean>;
  findAuthenticationRecord(
    keyId: string,
  ): Promise<ApiClientAuthenticationRecord | undefined>;
  touchUsage(
    clientId: string,
    keyId: string,
    usedAt: Date,
    touchBefore: Date,
  ): Promise<void>;
}
''',
    'packages/server/src/modules/api-client/infrastructure/crypto/hmac-api-client-token-issuer.ts': r'''import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { createUuidV7 } from '../../../../core';
import type { IssuedApiClientSecret } from '../../domain/api-client';
import type {
  ApiClientTokenIssuerPort,
  ParsedApiClientToken,
} from '../../ports/api-client-token-issuer.port';

const TOKEN_PATTERN =
  /^atlas_live_(?<keyId>[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(?<secret>[A-Za-z0-9_-]{32,128})$/u;

export class HmacApiClientTokenIssuer implements ApiClientTokenIssuerPort {
  public constructor(private readonly pepper: string) {
    if (Buffer.byteLength(pepper, 'utf8') < 32) {
      throw new RangeError('API Client Key Pepper must contain at least 32 bytes.');
    }
  }

  public issue(issuedAt: Date): Readonly<IssuedApiClientSecret> {
    const id = createUuidV7(issuedAt.getTime());
    const secret = randomBytes(32).toString('base64url');
    const token = `atlas_live_${id}.${secret}`;

    return Object.freeze({
      id,
      token,
      keyPrefix: `atlas_live_${id.slice(0, 8)}`,
      secretDigest: this.digestSecret(secret),
      createdAt: new Date(issuedAt),
    });
  }

  public parse(token: string): Readonly<ParsedApiClientToken> | undefined {
    if (token.length > 256) {
      return undefined;
    }

    const groups = TOKEN_PATTERN.exec(token)?.groups;

    return groups?.keyId && groups.secret
      ? Object.freeze({ keyId: groups.keyId, secret: groups.secret })
      : undefined;
  }

  public digestSecret(secret: string): string {
    return createHmac('sha256', this.pepper).update(secret, 'utf8').digest('hex');
  }

  public matchesSecret(secret: string, expectedDigest: string): boolean {
    const actual = Buffer.from(this.digestSecret(secret), 'hex');
    const expected = Buffer.from(expectedDigest, 'hex');

    return actual.length === 32 && expected.length === 32 && timingSafeEqual(actual, expected);
  }
}
''',
    'packages/server/src/modules/api-client/infrastructure/persistence/api-client.entity.ts': r'''import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type { ApiClientStatus } from '../../domain/api-client';

@Entity({ name: 'api_clients' })
@Index('idx_api_clients_site_created_at', ['siteId', 'createdAt'])
export class ApiClientEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  public workspaceId!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  public siteId!: string;

  @Column({ type: 'varchar', length: 120 })
  public name!: string;

  @Column({ type: 'varchar', length: 16 })
  public status!: ApiClientStatus;

  @Column({ name: 'allowed_origins', type: 'jsonb', default: () => "'[]'::jsonb" })
  public allowedOrigins!: string[];

  @Column({ name: 'rate_limit_per_minute', type: 'integer' })
  public rateLimitPerMinute!: number;

  @Column({ type: 'integer', default: 1 })
  public version!: number;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  public lastUsedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  public revokedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
''',
    'packages/server/src/modules/api-client/infrastructure/persistence/api-client-scope.entity.ts': r'''import { Entity, PrimaryColumn } from 'typeorm';

import type { ApiClientScope } from '../../domain/api-client';

@Entity({ name: 'api_client_scopes' })
export class ApiClientScopeEntity {
  @PrimaryColumn({ name: 'api_client_id', type: 'uuid' })
  public apiClientId!: string;

  @PrimaryColumn({ type: 'varchar', length: 64 })
  public scope!: ApiClientScope;
}
''',
    'packages/server/src/modules/api-client/infrastructure/persistence/api-client-key.entity.ts': r'''import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type { ApiClientKeyStatus } from '../../domain/api-client';

@Entity({ name: 'api_client_keys' })
@Index('uq_api_client_keys_prefix', ['keyPrefix'], { unique: true })
@Index('idx_api_client_keys_client_created_at', ['apiClientId', 'createdAt'])
export class ApiClientKeyEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ name: 'api_client_id', type: 'uuid' })
  public apiClientId!: string;

  @Column({ name: 'key_prefix', type: 'varchar', length: 32 })
  public keyPrefix!: string;

  @Column({ name: 'secret_digest', type: 'char', length: 64 })
  public secretDigest!: string;

  @Column({ type: 'varchar', length: 16 })
  public status!: ApiClientKeyStatus;

  @Column({ name: 'not_before', type: 'timestamptz' })
  public notBefore!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  public expiresAt!: Date | null;

  @Column({ name: 'grace_expires_at', type: 'timestamptz', nullable: true })
  public graceExpiresAt!: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  public lastUsedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  public revokedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}
''',
    'packages/server/src/modules/api-client/application/api-client-management.service.ts': r'''import type { AuditService, Clock, TransactionRunner } from '../../../core';
import {
  AuditResult,
  DomainError,
  ErrorCode,
  createUuidV7,
  systemClock,
} from '../../../core';
import { SiteStatus, type SiteRepositoryPort } from '../../site';
import {
  ApiClientKeyStatus,
  ApiClientStatus,
  assertApiClientMutable,
  normalizeAllowedOrigins,
  normalizeApiClientKeyExpiration,
  normalizeApiClientName,
  normalizeApiClientScopes,
  normalizeRateLimitPerMinute,
  type ApiClientAggregate,
  type ApiClientKeyRecord,
  type ApiClientScope,
} from '../domain/api-client';
import type { ApiClientRepositoryPort } from '../ports/api-client.repository';
import type { ApiClientTokenIssuerPort } from '../ports/api-client-token-issuer.port';

export interface CreateApiClientInput {
  name: string;
  scopes: readonly string[];
  allowedOrigins?: readonly string[];
  rateLimitPerMinute: number;
  expiresAt?: Date;
}

export interface UpdateApiClientInput {
  version: number;
  name: string;
  scopes: readonly string[];
  allowedOrigins?: readonly string[];
  rateLimitPerMinute: number;
}

export interface IssuedApiClientKeyResult {
  client: Readonly<ApiClientAggregate>;
  issuedKey: Readonly<{
    id: string;
    token: string;
    keyPrefix: string;
    status: ApiClientKeyStatus;
    notBefore: Date;
    expiresAt?: Date;
    createdAt: Date;
  }>;
}

export class ApiClientManagementService<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: ApiClientRepositoryPort<TTransaction>,
    private readonly siteRepository: SiteRepositoryPort<TTransaction>,
    private readonly tokenIssuer: ApiClientTokenIssuerPort,
    private readonly auditService: AuditService<TTransaction>,
    private readonly defaultGraceMs: number,
    private readonly clock: Clock = systemClock,
  ) {
    if (!Number.isSafeInteger(defaultGraceMs) || defaultGraceMs < 0) {
      throw new RangeError('Default API Client Key grace period is invalid.');
    }
  }

  public listClients(
    workspaceId: string,
    siteId: string,
  ): Promise<readonly ApiClientAggregate[]> {
    return this.repository.listBySite(workspaceId, siteId);
  }

  public async getClient(
    workspaceId: string,
    siteId: string,
    clientId: string,
  ): Promise<Readonly<ApiClientAggregate>> {
    const client = await this.repository.findById(workspaceId, siteId, clientId);

    if (!client) {
      throw clientNotFoundError();
    }

    return Object.freeze(client);
  }

  public async createClient(
    workspaceId: string,
    siteId: string,
    input: CreateApiClientInput,
  ): Promise<Readonly<IssuedApiClientKeyResult>> {
    const now = this.clock.now();
    const normalized = normalizeInput(input, now);
    const clientId = createUuidV7(now.getTime());
    const issued = this.tokenIssuer.issue(now);

    return this.transactionRunner.run(async (transaction) => {
      const site = await this.siteRepository.findById(workspaceId, siteId, transaction);

      if (!site) {
        throw new DomainError({
          code: ErrorCode.SITE_NOT_FOUND,
          message: 'Site was not found.',
        });
      }

      if (site.status === SiteStatus.ARCHIVED) {
        throw new DomainError({
          code: ErrorCode.ACTION_NOT_ALLOWED,
          message: 'API Clients cannot be created for archived Sites.',
        });
      }

      await this.assertNameAvailable(
        workspaceId,
        siteId,
        normalized.name,
        undefined,
        transaction,
      );

      const key: ApiClientKeyRecord = {
        id: issued.id,
        apiClientId: clientId,
        keyPrefix: issued.keyPrefix,
        secretDigest: issued.secretDigest,
        status: ApiClientKeyStatus.ACTIVE,
        notBefore: now,
        expiresAt: normalized.expiresAt,
        createdAt: now,
      };
      const client: ApiClientAggregate = {
        id: clientId,
        workspaceId,
        siteId,
        name: normalized.name,
        status: ApiClientStatus.ACTIVE,
        allowedOrigins: normalized.allowedOrigins,
        rateLimitPerMinute: normalized.rateLimitPerMinute,
        version: 1,
        createdAt: now,
        updatedAt: now,
        scopes: normalized.scopes,
        keys: Object.freeze([key]),
      };

      await this.repository.insert(
        { ...client, initialKey: key },
        transaction,
      );
      await this.auditService.record(
        {
          action: 'api-client.created',
          targetType: 'api-client',
          targetId: clientId,
          result: AuditResult.SUCCESS,
          metadata: {
            siteId,
            scopes: normalized.scopes,
            allowedOriginCount: normalized.allowedOrigins.length,
            rateLimitPerMinute: normalized.rateLimitPerMinute,
            keyId: issued.id,
          },
        },
        transaction,
      );

      return issueResult(client, key, issued.token);
    });
  }

  public async updateClient(
    workspaceId: string,
    siteId: string,
    clientId: string,
    input: UpdateApiClientInput,
  ): Promise<Readonly<ApiClientAggregate>> {
    assertVersion(input.version);
    const now = this.clock.now();
    const normalized = normalizeInput(input, now);

    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findById(
        workspaceId,
        siteId,
        clientId,
        transaction,
      );

      if (!current) {
        throw clientNotFoundError();
      }

      assertApiClientMutable(current.status);
      await this.assertNameAvailable(
        workspaceId,
        siteId,
        normalized.name,
        clientId,
        transaction,
      );
      const updated = await this.repository.update(
        workspaceId,
        siteId,
        clientId,
        {
          name: normalized.name,
          scopes: normalized.scopes,
          allowedOrigins: normalized.allowedOrigins,
          rateLimitPerMinute: normalized.rateLimitPerMinute,
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
          targetId: clientId,
          result: AuditResult.SUCCESS,
          metadata: {
            siteId,
            changedFields: [
              'name',
              'scopes',
              'allowedOrigins',
              'rateLimitPerMinute',
            ],
            version: input.version + 1,
          },
        },
        transaction,
      );

      return Object.freeze({
        ...current,
        name: normalized.name,
        scopes: normalized.scopes,
        allowedOrigins: normalized.allowedOrigins,
        rateLimitPerMinute: normalized.rateLimitPerMinute,
        version: input.version + 1,
        updatedAt: now,
      });
    });
  }

  public async rotateKey(
    workspaceId: string,
    siteId: string,
    clientId: string,
    input: Readonly<{ graceSeconds?: number; expiresAt?: Date }> = {},
  ): Promise<Readonly<IssuedApiClientKeyResult>> {
    const now = this.clock.now();
    const graceMs = normalizeGraceMs(input.graceSeconds, this.defaultGraceMs);
    const expiresAt = normalizeApiClientKeyExpiration(input.expiresAt, now);
    const issued = this.tokenIssuer.issue(now);

    return this.transactionRunner.run(async (transaction) => {
      const client = await this.repository.findById(
        workspaceId,
        siteId,
        clientId,
        transaction,
      );

      if (!client) {
        throw clientNotFoundError();
      }

      assertApiClientMutable(client.status);

      if (client.status !== ApiClientStatus.ACTIVE) {
        throw new DomainError({
          code: ErrorCode.ACTION_NOT_ALLOWED,
          message: 'Only active API Clients can rotate Keys.',
        });
      }

      const graceExpiresAt = graceMs > 0 ? new Date(now.getTime() + graceMs) : undefined;
      await this.repository.transitionActiveKeys(
        clientId,
        now,
        graceExpiresAt,
        transaction,
      );
      const key: ApiClientKeyRecord = {
        id: issued.id,
        apiClientId: clientId,
        keyPrefix: issued.keyPrefix,
        secretDigest: issued.secretDigest,
        status: ApiClientKeyStatus.ACTIVE,
        notBefore: now,
        expiresAt,
        createdAt: now,
      };
      await this.repository.insertKey(key, transaction);
      await this.auditService.record(
        {
          action: 'api-client.key-rotated',
          targetType: 'api-client',
          targetId: clientId,
          result: AuditResult.SUCCESS,
          metadata: {
            siteId,
            keyId: key.id,
            graceSeconds: Math.floor(graceMs / 1_000),
          },
        },
        transaction,
      );

      const updated: ApiClientAggregate = {
        ...client,
        keys: Object.freeze([
          key,
          ...client.keys.map((currentKey) =>
            currentKey.status === ApiClientKeyStatus.ACTIVE
              ? graceExpiresAt
                ? {
                    ...currentKey,
                    status: ApiClientKeyStatus.GRACE,
                    graceExpiresAt,
                  }
                : {
                    ...currentKey,
                    status: ApiClientKeyStatus.REVOKED,
                    revokedAt: now,
                  }
              : currentKey,
          ),
        ]),
      };

      return issueResult(updated, key, issued.token);
    });
  }

  public async setStatus(
    workspaceId: string,
    siteId: string,
    clientId: string,
    target: ApiClientStatus,
    version: number,
  ): Promise<Readonly<ApiClientAggregate>> {
    assertVersion(version);
    const now = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const current = await this.repository.findById(
        workspaceId,
        siteId,
        clientId,
        transaction,
      );

      if (!current) {
        throw clientNotFoundError();
      }

      assertApiClientMutable(current.status);

      if (target === ApiClientStatus.REVOKED) {
        await this.repository.transitionActiveKeys(clientId, now, undefined, transaction);
      }

      const changed = await this.repository.updateStatus(
        workspaceId,
        siteId,
        clientId,
        {
          status: target,
          expectedVersion: version,
          nextVersion: version + 1,
          updatedAt: now,
          revokedAt: target === ApiClientStatus.REVOKED ? now : undefined,
        },
        transaction,
      );

      if (!changed) {
        throw versionConflictError();
      }

      await this.auditService.record(
        {
          action:
            target === ApiClientStatus.REVOKED
              ? 'api-client.revoked'
              : 'api-client.status-changed',
          targetType: 'api-client',
          targetId: clientId,
          result: AuditResult.SUCCESS,
          metadata: {
            siteId,
            previousStatus: current.status,
            status: target,
            version: version + 1,
          },
        },
        transaction,
      );

      return Object.freeze({
        ...current,
        status: target,
        version: version + 1,
        updatedAt: now,
        revokedAt: target === ApiClientStatus.REVOKED ? now : undefined,
        keys:
          target === ApiClientStatus.REVOKED
            ? Object.freeze(
                current.keys.map((key) =>
                  key.status === ApiClientKeyStatus.REVOKED
                    ? key
                    : {
                        ...key,
                        status: ApiClientKeyStatus.REVOKED,
                        revokedAt: now,
                      },
                ),
              )
            : current.keys,
      });
    });
  }

  public async revokeKey(
    workspaceId: string,
    siteId: string,
    clientId: string,
    keyId: string,
  ): Promise<void> {
    const now = this.clock.now();

    await this.transactionRunner.run(async (transaction) => {
      const client = await this.repository.findById(
        workspaceId,
        siteId,
        clientId,
        transaction,
      );

      if (!client) {
        throw clientNotFoundError();
      }

      const key = await this.repository.findKeyForClient(
        workspaceId,
        siteId,
        clientId,
        keyId,
        transaction,
      );

      if (!key) {
        throw new DomainError({
          code: ErrorCode.NOT_FOUND,
          message: 'API Client Key was not found.',
        });
      }

      if (key.status !== ApiClientKeyStatus.REVOKED) {
        await this.repository.revokeKey(keyId, now, transaction);
      }
      await this.auditService.record(
        {
          action: 'api-client.key-revoked',
          targetType: 'api-client-key',
          targetId: keyId,
          result: AuditResult.SUCCESS,
          metadata: { clientId, siteId },
        },
        transaction,
      );
    });
  }

  private async assertNameAvailable(
    workspaceId: string,
    siteId: string,
    name: string,
    currentClientId: string | undefined,
    transaction: TTransaction,
  ): Promise<void> {
    const owner = await this.repository.findNameOwner(
      workspaceId,
      siteId,
      name,
      transaction,
    );

    if (owner && owner !== currentClientId) {
      throw new DomainError({
        code: ErrorCode.VERSION_CONFLICT,
        message: 'API Client name is already in use in this Site.',
        details: { field: 'name' },
      });
    }
  }
}

function normalizeInput(
  input: CreateApiClientInput | UpdateApiClientInput,
  now: Date,
) {
  return {
    name: normalizeApiClientName(input.name),
    scopes: normalizeApiClientScopes(input.scopes),
    allowedOrigins: normalizeAllowedOrigins(input.allowedOrigins ?? []),
    rateLimitPerMinute: normalizeRateLimitPerMinute(input.rateLimitPerMinute),
    expiresAt:
      'expiresAt' in input
        ? normalizeApiClientKeyExpiration(input.expiresAt, now)
        : undefined,
  };
}

function issueResult(
  client: ApiClientAggregate,
  key: ApiClientKeyRecord,
  token: string,
): Readonly<IssuedApiClientKeyResult> {
  return Object.freeze({
    client: Object.freeze(client),
    issuedKey: Object.freeze({
      id: key.id,
      token,
      keyPrefix: key.keyPrefix,
      status: key.status,
      notBefore: new Date(key.notBefore),
      expiresAt: key.expiresAt ? new Date(key.expiresAt) : undefined,
      createdAt: new Date(key.createdAt),
    }),
  });
}

function normalizeGraceMs(value: number | undefined, defaultGraceMs: number): number {
  if (value === undefined) {
    return defaultGraceMs;
  }

  if (!Number.isSafeInteger(value) || value < 0 || value > 604_800) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'API Client Key grace period must be between 0 and 604,800 seconds.',
      details: { field: 'graceSeconds' },
    });
  }

  return value * 1_000;
}

function assertVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'API Client version is invalid.',
      details: { field: 'version' },
    });
  }
}

function clientNotFoundError(): DomainError {
  return new DomainError({
    code: ErrorCode.NOT_FOUND,
    message: 'API Client was not found.',
  });
}

function versionConflictError(): DomainError {
  return new DomainError({
    code: ErrorCode.VERSION_CONFLICT,
    message: 'API Client was changed by another request.',
  });
}
''',
    'packages/server/src/modules/api-client/application/api-client-authentication.service.ts': r'''import type { Clock } from '../../../core';
import {
  ActorType,
  DomainError,
  ErrorCode,
  requestContext,
  systemClock,
} from '../../../core';
import { SiteStatus } from '../../site';
import {
  ApiClientStatus,
  isApiClientKeyUsable,
  type ApiClientScope,
} from '../domain/api-client';
import type { ApiClientRateLimiterPort } from '../ports/api-client-rate-limiter.port';
import type { ApiClientRepositoryPort } from '../ports/api-client.repository';
import type { ApiClientTokenIssuerPort } from '../ports/api-client-token-issuer.port';

export interface ApiClientPrincipal {
  apiClientId: string;
  keyId: string;
  workspaceId: string;
  siteId: string;
  siteKey: string;
  siteName: string;
  scopes: readonly ApiClientScope[];
}

export interface AuthenticateApiClientInput {
  authorization?: string;
  origin?: string;
}

export class ApiClientAuthenticationService<TTransaction = unknown> {
  public constructor(
    private readonly repository: ApiClientRepositoryPort<TTransaction>,
    private readonly tokenIssuer: ApiClientTokenIssuerPort,
    private readonly rateLimiter: ApiClientRateLimiterPort,
    private readonly usageTouchMs: number,
    private readonly clock: Clock = systemClock,
  ) {
    if (!Number.isSafeInteger(usageTouchMs) || usageTouchMs < 1_000) {
      throw new RangeError('API Client usage touch interval is invalid.');
    }
  }

  public async authenticate(
    input: AuthenticateApiClientInput,
  ): Promise<Readonly<ApiClientPrincipal>> {
    const token = readBearerToken(input.authorization);
    const parsed = token ? this.tokenIssuer.parse(token) : undefined;

    if (!parsed) {
      throw authenticationRequiredError();
    }

    const record = await this.repository.findAuthenticationRecord(parsed.keyId);
    const now = this.clock.now();

    if (
      !record ||
      !this.tokenIssuer.matchesSecret(parsed.secret, record.key.secretDigest) ||
      record.client.status !== ApiClientStatus.ACTIVE ||
      record.site.status !== SiteStatus.ACTIVE ||
      !isApiClientKeyUsable(record.key, now)
    ) {
      throw authenticationRequiredError();
    }

    assertOriginAllowed(record.client.allowedOrigins, input.origin);
    const rateLimit = await this.rateLimiter.consume(
      `api-client:${record.client.id}:${record.key.id}`,
      record.client.rateLimitPerMinute,
      now,
    );

    if (!rateLimit.allowed) {
      throw new DomainError({
        code: ErrorCode.RATE_LIMITED,
        message: 'API Client rate limit was exceeded.',
        details: {
          retryAfterSeconds: rateLimit.retryAfterSeconds,
          remaining: rateLimit.remaining,
        },
      });
    }

    await this.repository.touchUsage(
      record.client.id,
      record.key.id,
      now,
      new Date(now.getTime() - this.usageTouchMs),
    );

    return Object.freeze({
      apiClientId: record.client.id,
      keyId: record.key.id,
      workspaceId: record.client.workspaceId,
      siteId: record.client.siteId,
      siteKey: record.site.key,
      siteName: record.site.name,
      scopes: Object.freeze([...record.scopes]),
    });
  }

  public assertScope(
    principal: Readonly<ApiClientPrincipal>,
    scope: ApiClientScope,
  ): void {
    if (!principal.scopes.includes(scope)) {
      throw new DomainError({
        code: ErrorCode.FORBIDDEN,
        message: 'API Client scope is required.',
        details: { scope },
      });
    }
  }

  public assertSiteKey(
    principal: Readonly<ApiClientPrincipal>,
    siteKey: string,
  ): void {
    if (principal.siteKey !== siteKey) {
      throw new DomainError({
        code: ErrorCode.FORBIDDEN,
        message: 'API Client cannot access the requested Site.',
      });
    }
  }

  public enterRequestContext(principal: Readonly<ApiClientPrincipal>): void {
    const current = requestContext.require();
    requestContext.enter({
      ...current,
      actorType: ActorType.API_CLIENT,
      actorId: principal.apiClientId,
      workspaceId: principal.workspaceId,
      siteId: principal.siteId,
    });
  }
}

function readBearerToken(value?: string): string | undefined {
  if (!value || value.length > 512) {
    return undefined;
  }

  const match = /^Bearer (?<token>\S+)$/u.exec(value.trim());
  return match?.groups?.token;
}

function assertOriginAllowed(
  allowedOrigins: readonly string[],
  origin?: string,
): void {
  if (!origin || allowedOrigins.length === 0) {
    return;
  }

  let normalized: string;

  try {
    normalized = new URL(origin).origin;
  } catch {
    throw forbiddenOriginError();
  }

  if (!allowedOrigins.includes(normalized)) {
    throw forbiddenOriginError();
  }
}

function authenticationRequiredError(): DomainError {
  return new DomainError({
    code: ErrorCode.AUTH_REQUIRED,
    message: 'A valid API Client Key is required.',
  });
}

function forbiddenOriginError(): DomainError {
  return new DomainError({
    code: ErrorCode.FORBIDDEN,
    message: 'Request Origin is not allowed for this API Client.',
  });
}
''',
    'packages/server/src/modules/api-client/infrastructure/persistence/typeorm-api-client.repository.ts': r'''import { In, type DataSource, type EntityManager } from 'typeorm';

import { SiteEntity } from '../../../site';
import {
  ApiClientKeyStatus,
  ApiClientStatus,
  type ApiClientAggregate,
  type ApiClientAuthenticationRecord,
  type ApiClientKeyRecord,
  type ApiClientRecord,
  type ApiClientScope,
} from '../../domain/api-client';
import type {
  ApiClientRepositoryPort,
  InsertApiClientRecordInput,
  UpdateApiClientRecordInput,
  UpdateApiClientStatusInput,
} from '../../ports/api-client.repository';
import { ApiClientEntity } from './api-client.entity';
import { ApiClientKeyEntity } from './api-client-key.entity';
import { ApiClientScopeEntity } from './api-client-scope.entity';

export class TypeOrmApiClientRepository
  implements ApiClientRepositoryPort<EntityManager>
{
  public constructor(private readonly dataSource: DataSource) {}

  public async listBySite(
    workspaceId: string,
    siteId: string,
  ): Promise<readonly ApiClientAggregate[]> {
    const clients = await this.dataSource.getRepository(ApiClientEntity).find({
      where: { workspaceId, siteId },
      order: { createdAt: 'DESC' },
      take: 100,
    });

    return this.attachChildren(clients, this.dataSource.manager);
  }

  public async findById(
    workspaceId: string,
    siteId: string,
    clientId: string,
    transaction?: EntityManager,
  ): Promise<ApiClientAggregate | undefined> {
    const manager = transaction ?? this.dataSource.manager;
    const entity = await manager.getRepository(ApiClientEntity).findOne({
      where: { id: clientId, workspaceId, siteId },
    });

    if (!entity) {
      return undefined;
    }

    const [aggregate] = await this.attachChildren([entity], manager);
    return aggregate;
  }

  public async findNameOwner(
    workspaceId: string,
    siteId: string,
    name: string,
    transaction?: EntityManager,
  ): Promise<string | undefined> {
    const entity = await (transaction ?? this.dataSource.manager)
      .getRepository(ApiClientEntity)
      .createQueryBuilder('client')
      .select(['client.id'])
      .where('client.workspace_id = :workspaceId', { workspaceId })
      .andWhere('client.site_id = :siteId', { siteId })
      .andWhere('lower(client.name) = lower(:name)', { name })
      .getOne();

    return entity?.id;
  }

  public async insert(
    client: InsertApiClientRecordInput,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(ApiClientEntity).insert({
      id: client.id,
      workspaceId: client.workspaceId,
      siteId: client.siteId,
      name: client.name,
      status: client.status,
      allowedOrigins: [...client.allowedOrigins],
      rateLimitPerMinute: client.rateLimitPerMinute,
      version: client.version,
      lastUsedAt: client.lastUsedAt ?? null,
      revokedAt: client.revokedAt ?? null,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    });
    await transaction.getRepository(ApiClientScopeEntity).insert(
      client.scopes.map((scope) => ({ apiClientId: client.id, scope })),
    );
    await this.insertKey(client.initialKey, transaction);
  }

  public async update(
    workspaceId: string,
    siteId: string,
    clientId: string,
    input: UpdateApiClientRecordInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(ApiClientEntity).update(
      {
        id: clientId,
        workspaceId,
        siteId,
        version: input.expectedVersion,
      },
      {
        name: input.name,
        allowedOrigins: [...input.allowedOrigins],
        rateLimitPerMinute: input.rateLimitPerMinute,
        version: input.nextVersion,
        updatedAt: input.updatedAt,
      },
    );

    if ((result.affected ?? 0) !== 1) {
      return false;
    }

    await transaction.getRepository(ApiClientScopeEntity).delete({
      apiClientId: clientId,
    });
    await transaction.getRepository(ApiClientScopeEntity).insert(
      input.scopes.map((scope) => ({ apiClientId: clientId, scope })),
    );
    return true;
  }

  public async updateStatus(
    workspaceId: string,
    siteId: string,
    clientId: string,
    input: UpdateApiClientStatusInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(ApiClientEntity).update(
      {
        id: clientId,
        workspaceId,
        siteId,
        version: input.expectedVersion,
      },
      {
        status: input.status,
        version: input.nextVersion,
        updatedAt: input.updatedAt,
        revokedAt: input.revokedAt ?? null,
      },
    );

    return (result.affected ?? 0) === 1;
  }

  public async transitionActiveKeys(
    clientId: string,
    rotatedAt: Date,
    graceExpiresAt: Date | undefined,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction
      .getRepository(ApiClientKeyEntity)
      .createQueryBuilder()
      .update(ApiClientKeyEntity)
      .set(
        graceExpiresAt
          ? {
              status: ApiClientKeyStatus.GRACE,
              graceExpiresAt,
            }
          : {
              status: ApiClientKeyStatus.REVOKED,
              revokedAt: rotatedAt,
              graceExpiresAt: null,
            },
      )
      .where('api_client_id = :clientId', { clientId })
      .andWhere('status = :status', { status: ApiClientKeyStatus.ACTIVE })
      .execute();
  }

  public async insertKey(
    key: ApiClientKeyRecord,
    transaction: EntityManager,
  ): Promise<void> {
    await transaction.getRepository(ApiClientKeyEntity).insert({
      id: key.id,
      apiClientId: key.apiClientId,
      keyPrefix: key.keyPrefix,
      secretDigest: key.secretDigest,
      status: key.status,
      notBefore: key.notBefore,
      expiresAt: key.expiresAt ?? null,
      graceExpiresAt: key.graceExpiresAt ?? null,
      lastUsedAt: key.lastUsedAt ?? null,
      revokedAt: key.revokedAt ?? null,
      createdAt: key.createdAt,
    });
  }

  public async findKeyForClient(
    workspaceId: string,
    siteId: string,
    clientId: string,
    keyId: string,
    transaction?: EntityManager,
  ): Promise<ApiClientKeyRecord | undefined> {
    const manager = transaction ?? this.dataSource.manager;
    const client = await manager.getRepository(ApiClientEntity).findOne({
      where: { id: clientId, workspaceId, siteId },
      select: { id: true },
    });

    if (!client) {
      return undefined;
    }

    const key = await manager.getRepository(ApiClientKeyEntity).findOne({
      where: { id: keyId, apiClientId: clientId },
    });
    return key ? toKeyRecord(key) : undefined;
  }

  public async revokeKey(
    keyId: string,
    revokedAt: Date,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction
      .getRepository(ApiClientKeyEntity)
      .createQueryBuilder()
      .update(ApiClientKeyEntity)
      .set({
        status: ApiClientKeyStatus.REVOKED,
        revokedAt,
        graceExpiresAt: null,
      })
      .where('id = :keyId', { keyId })
      .andWhere('status <> :revoked', { revoked: ApiClientKeyStatus.REVOKED })
      .execute();

    return (result.affected ?? 0) === 1;
  }

  public async findAuthenticationRecord(
    keyId: string,
  ): Promise<ApiClientAuthenticationRecord | undefined> {
    const key = await this.dataSource.getRepository(ApiClientKeyEntity).findOne({
      where: { id: keyId },
    });

    if (!key) {
      return undefined;
    }

    const client = await this.dataSource.getRepository(ApiClientEntity).findOne({
      where: { id: key.apiClientId },
    });

    if (!client) {
      return undefined;
    }

    const site = await this.dataSource.getRepository(SiteEntity).findOne({
      where: {
        id: client.siteId,
        workspaceId: client.workspaceId,
      },
    });

    if (!site) {
      return undefined;
    }

    const scopes = await this.dataSource.getRepository(ApiClientScopeEntity).find({
      where: { apiClientId: client.id },
      order: { scope: 'ASC' },
    });

    return {
      client: toClientRecord(client),
      key: toKeyRecord(key),
      scopes: Object.freeze(scopes.map((scope) => scope.scope)),
      site: {
        id: site.id,
        key: site.key,
        name: site.name,
        status: site.status,
      },
    };
  }

  public async touchUsage(
    clientId: string,
    keyId: string,
    usedAt: Date,
    touchBefore: Date,
  ): Promise<void> {
    await Promise.all([
      this.dataSource
        .getRepository(ApiClientEntity)
        .createQueryBuilder()
        .update(ApiClientEntity)
        .set({ lastUsedAt: usedAt })
        .where('id = :clientId', { clientId })
        .andWhere('(last_used_at IS NULL OR last_used_at < :touchBefore)', {
          touchBefore,
        })
        .execute(),
      this.dataSource
        .getRepository(ApiClientKeyEntity)
        .createQueryBuilder()
        .update(ApiClientKeyEntity)
        .set({ lastUsedAt: usedAt })
        .where('id = :keyId', { keyId })
        .andWhere('(last_used_at IS NULL OR last_used_at < :touchBefore)', {
          touchBefore,
        })
        .execute(),
    ]);
  }

  private async attachChildren(
    clients: readonly ApiClientEntity[],
    manager: EntityManager,
  ): Promise<ApiClientAggregate[]> {
    if (clients.length === 0) {
      return [];
    }

    const ids = clients.map((client) => client.id);
    const [scopes, keys] = await Promise.all([
      manager.getRepository(ApiClientScopeEntity).find({
        where: { apiClientId: In(ids) },
        order: { scope: 'ASC' },
      }),
      manager.getRepository(ApiClientKeyEntity).find({
        where: { apiClientId: In(ids) },
        order: { createdAt: 'DESC' },
      }),
    ]);
    const scopesByClient = groupScopes(scopes);
    const keysByClient = groupKeys(keys);

    return clients.map((client) => ({
      ...toClientRecord(client),
      scopes: Object.freeze(scopesByClient.get(client.id) ?? []),
      keys: Object.freeze(keysByClient.get(client.id) ?? []),
    }));
  }
}

function toClientRecord(entity: ApiClientEntity): ApiClientRecord {
  return {
    id: entity.id,
    workspaceId: entity.workspaceId,
    siteId: entity.siteId,
    name: entity.name,
    status: entity.status,
    allowedOrigins: Object.freeze([...entity.allowedOrigins]),
    rateLimitPerMinute: entity.rateLimitPerMinute,
    version: entity.version,
    lastUsedAt: entity.lastUsedAt ? new Date(entity.lastUsedAt) : undefined,
    revokedAt: entity.revokedAt ? new Date(entity.revokedAt) : undefined,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

function toKeyRecord(entity: ApiClientKeyEntity): ApiClientKeyRecord {
  return {
    id: entity.id,
    apiClientId: entity.apiClientId,
    keyPrefix: entity.keyPrefix,
    secretDigest: entity.secretDigest,
    status: entity.status,
    notBefore: new Date(entity.notBefore),
    expiresAt: entity.expiresAt ? new Date(entity.expiresAt) : undefined,
    graceExpiresAt: entity.graceExpiresAt
      ? new Date(entity.graceExpiresAt)
      : undefined,
    lastUsedAt: entity.lastUsedAt ? new Date(entity.lastUsedAt) : undefined,
    revokedAt: entity.revokedAt ? new Date(entity.revokedAt) : undefined,
    createdAt: new Date(entity.createdAt),
  };
}

function groupScopes(
  entities: readonly ApiClientScopeEntity[],
): Map<string, ApiClientScope[]> {
  const grouped = new Map<string, ApiClientScope[]>();

  for (const entity of entities) {
    const values = grouped.get(entity.apiClientId) ?? [];
    values.push(entity.scope);
    grouped.set(entity.apiClientId, values);
  }

  return grouped;
}

function groupKeys(
  entities: readonly ApiClientKeyEntity[],
): Map<string, ApiClientKeyRecord[]> {
  const grouped = new Map<string, ApiClientKeyRecord[]>();

  for (const entity of entities) {
    const values = grouped.get(entity.apiClientId) ?? [];
    values.push(toKeyRecord(entity));
    grouped.set(entity.apiClientId, values);
  }

  return grouped;
}
''',
    'packages/server/src/modules/api-client/index.ts': r'''export * from './application/api-client-authentication.service';
export * from './application/api-client-management.service';
export * from './domain/api-client';
export * from './infrastructure/crypto/hmac-api-client-token-issuer';
export * from './infrastructure/persistence/api-client.entity';
export * from './infrastructure/persistence/api-client-key.entity';
export * from './infrastructure/persistence/api-client-scope.entity';
export * from './infrastructure/persistence/typeorm-api-client.repository';
export * from './ports/api-client-rate-limiter.port';
export * from './ports/api-client-token-issuer.port';
export * from './ports/api-client.repository';
''',
}
