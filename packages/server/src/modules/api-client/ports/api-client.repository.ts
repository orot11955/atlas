import type {
  ApiClientKeyRecord,
  ApiClientRecord,
  ApiClientScope,
  ApiClientSiteContext,
  ApiClientStatus,
  ApiClientType,
} from '../domain/api-client';

export interface ApiClientListQuery {
  siteId?: string;
  status?: ApiClientStatus;
  type?: ApiClientType;
  search?: string;
}

export interface StoredApiClientKey extends ApiClientKeyRecord {
  secretDigest: string;
}

export interface InsertApiClientAggregate {
  client: ApiClientRecord;
  initialKey: StoredApiClientKey;
}

export interface UpdateApiClientConfigurationInput {
  name: string;
  description?: string;
  rateLimitPerMinute: number;
  requireOrigin: boolean;
  siteIds: readonly string[];
  scopes: readonly ApiClientScope[];
  allowedOrigins: readonly string[];
  expectedVersion: number;
  nextVersion: number;
  updatedAt: Date;
}

export interface UpdateApiClientStatusInput {
  status: ApiClientStatus;
  disabledAt?: Date;
  archivedAt?: Date;
  expectedVersion: number;
  nextVersion: number;
  updatedAt: Date;
}

export interface ApiClientAuthenticationRecord {
  clientId: string;
  workspaceId: string;
  type: ApiClientType;
  status: ApiClientStatus;
  rateLimitPerMinute: number;
  requireOrigin: boolean;
  siteIds: readonly string[];
  scopes: readonly ApiClientScope[];
  allowedOrigins: readonly string[];
  key: StoredApiClientKey;
}

export interface ApiClientRepositoryPort<TTransaction = unknown> {
  list(workspaceId: string, query: ApiClientListQuery): Promise<readonly ApiClientRecord[]>;
  findById(
    workspaceId: string,
    apiClientId: string,
    transaction?: TTransaction,
  ): Promise<ApiClientRecord | undefined>;
  findExistingSiteIds(
    workspaceId: string,
    siteIds: readonly string[],
    transaction?: TTransaction,
  ): Promise<readonly string[]>;
  insert(aggregate: InsertApiClientAggregate, transaction: TTransaction): Promise<void>;
  updateConfiguration(
    workspaceId: string,
    apiClientId: string,
    input: UpdateApiClientConfigurationInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  updateStatus(
    workspaceId: string,
    apiClientId: string,
    input: UpdateApiClientStatusInput,
    transaction: TTransaction,
  ): Promise<boolean>;
  revokeAllOpenKeys(
    apiClientId: string,
    revokedAt: Date,
    transaction: TTransaction,
  ): Promise<number>;
  findCurrentKeyForUpdate(
    apiClientId: string,
    transaction: TTransaction,
  ): Promise<StoredApiClientKey | undefined>;
  findKeyForUpdate(
    apiClientId: string,
    keyId: string,
    transaction: TTransaction,
  ): Promise<StoredApiClientKey | undefined>;
  markKeyReplaced(
    keyId: string,
    replacementKeyId: string,
    graceExpiresAt: Date,
    transaction: TTransaction,
  ): Promise<void>;
  insertKey(key: StoredApiClientKey, transaction: TTransaction): Promise<void>;
  revokeKey(keyId: string, revokedAt: Date, transaction: TTransaction): Promise<void>;
  findAuthenticationRecord(keyId: string): Promise<ApiClientAuthenticationRecord | undefined>;
  findSiteByKey(workspaceId: string, siteKey: string): Promise<ApiClientSiteContext | undefined>;
  touchKeyUsage(keyId: string, usedAt: Date, minimumPreviousUsage: Date): Promise<void>;
}
