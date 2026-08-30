import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ActorType,
  ApiClientAuthenticationService,
  ApiClientScope,
  ApiClientStatus,
  ApiClientType,
  DomainError,
  ErrorCode,
  FixedClock,
  HmacApiClientKeyIssuer,
  SiteStatus,
  SiteType,
  requestContext,
  type ApiClientAuthenticationRecord,
  type ApiClientListQuery,
  type ApiClientRateLimiterPort,
  type ApiClientRecord,
  type ApiClientRepositoryPort,
  type ApiClientSiteContext,
  type InsertApiClientAggregate,
  type StoredApiClientKey,
  type UpdateApiClientConfigurationInput,
  type UpdateApiClientStatusInput,
} from './index';

type TestTransaction = Readonly<{ id: 'api-client-test' }>;

class MemoryApiClientRepository implements ApiClientRepositoryPort<TestTransaction> {
  public authenticationRecord?: ApiClientAuthenticationRecord;
  public site?: ApiClientSiteContext;
  public touchedKeyId?: string;

  public async list(
    _workspaceId: string,
    _query: ApiClientListQuery,
  ): Promise<readonly ApiClientRecord[]> {
    return [];
  }

  public async findById(): Promise<ApiClientRecord | undefined> {
    return undefined;
  }

  public async findExistingSiteIds(): Promise<readonly string[]> {
    return [];
  }

  public async insert(
    _aggregate: InsertApiClientAggregate,
    _transaction: TestTransaction,
  ): Promise<void> {}

  public async updateConfiguration(
    _workspaceId: string,
    _apiClientId: string,
    _input: UpdateApiClientConfigurationInput,
    _transaction: TestTransaction,
  ): Promise<boolean> {
    return false;
  }

  public async updateStatus(
    _workspaceId: string,
    _apiClientId: string,
    _input: UpdateApiClientStatusInput,
    _transaction: TestTransaction,
  ): Promise<boolean> {
    return false;
  }

  public async revokeAllOpenKeys(): Promise<number> {
    return 0;
  }

  public async findCurrentKeyForUpdate(): Promise<StoredApiClientKey | undefined> {
    return undefined;
  }

  public async findKeyForUpdate(): Promise<StoredApiClientKey | undefined> {
    return undefined;
  }

  public async markKeyReplaced(): Promise<void> {}

  public async insertKey(): Promise<void> {}

  public async revokeKey(): Promise<void> {}

  public async findAuthenticationRecord(
    keyId: string,
  ): Promise<ApiClientAuthenticationRecord | undefined> {
    return this.authenticationRecord?.key.id === keyId ? this.authenticationRecord : undefined;
  }

  public async findSiteByKey(
    workspaceId: string,
    siteKey: string,
  ): Promise<ApiClientSiteContext | undefined> {
    return this.site?.workspaceId === workspaceId && this.site.key === siteKey
      ? this.site
      : undefined;
  }

  public async touchKeyUsage(keyId: string): Promise<void> {
    this.touchedKeyId = keyId;
  }
}

class MemoryRateLimiter implements ApiClientRateLimiterPort {
  public allowed = true;

  public async consume() {
    return {
      allowed: this.allowed,
      retryAfterSeconds: this.allowed ? 0 : 17,
    };
  }
}

const clock = new FixedClock('2026-08-30T00:00:00.000Z');
const workspaceId = '01990000-0000-7000-8000-000000000001';
const clientId = '01990000-0000-7000-8000-000000000002';
const siteId = '01990000-0000-7000-8000-000000000003';
const pepper = 'atlas-api-client-test-pepper-with-adequate-length';

test('API Client Key issuer stores only an HMAC digest and validates in constant-time path', () => {
  const issuer = new HmacApiClientKeyIssuer(pepper);
  const issued = issuer.issue(clock.now());
  const parsed = issuer.parse(issued.apiKey);

  assert.match(issued.apiKey, /^atlas_live_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/u);
  assert.equal(parsed?.id, issued.id);
  assert.equal(parsed?.keyPrefix, issued.keyPrefix);
  assert.equal(issued.secretDigest.length, 64);
  assert.equal(issued.secretDigest.includes(parsed?.secret ?? ''), false);
  assert.equal(issuer.matches(issued.apiKey, issued.secretDigest), true);
  const replacement = issued.apiKey.endsWith('A') ? 'B' : 'A';
  const tamperedApiKey = `${issued.apiKey.slice(0, -1)}${replacement}`;
  assert.equal(issuer.matches(tamperedApiKey, issued.secretDigest), false);
});

test('Delivery authentication enforces type, scope, Site access, Origin and rate limit', async () => {
  const issuer = new HmacApiClientKeyIssuer(pepper);
  const issued = issuer.issue(clock.now());
  const repository = new MemoryApiClientRepository();
  const rateLimiter = new MemoryRateLimiter();
  repository.authenticationRecord = {
    clientId,
    workspaceId,
    type: ApiClientType.DELIVERY,
    status: ApiClientStatus.ACTIVE,
    rateLimitPerMinute: 60,
    requireOrigin: true,
    siteIds: [siteId],
    scopes: [ApiClientScope.SITE_READ],
    allowedOrigins: ['https://blog.example.com'],
    key: {
      id: issued.id,
      apiClientId: clientId,
      keyPrefix: issued.keyPrefix,
      secretDigest: issued.secretDigest,
      createdAt: clock.now(),
    },
  };
  repository.site = {
    id: siteId,
    workspaceId,
    key: 'main-blog',
    name: 'Main Blog',
    type: SiteType.BLOG,
    status: SiteStatus.ACTIVE,
    timezone: 'Asia/Seoul',
    locale: 'ko-KR',
    canonicalHostname: 'blog.example.com',
  };
  const service = new ApiClientAuthenticationService(
    repository,
    issuer,
    rateLimiter,
    60_000,
    clock,
  );

  await requestContext.run(
    {
      requestId: 'api-client-request',
      traceId: 'api-client-trace',
      actorType: ActorType.ANONYMOUS,
    },
    async () => {
      const principal = await service.authenticate({
        apiKey: issued.apiKey,
        requiredScope: ApiClientScope.SITE_READ,
        requiredType: ApiClientType.DELIVERY,
        siteKey: 'MAIN-BLOG',
        origin: 'https://blog.example.com/',
      });
      service.enterRequestContext(principal);

      assert.equal(principal.site.id, siteId);
      assert.equal(requestContext.require().actorType, ActorType.API_CLIENT);
      assert.equal(requestContext.require().actorId, clientId);
      assert.equal(requestContext.require().workspaceId, workspaceId);
      assert.equal(requestContext.require().siteId, siteId);
      assert.equal(repository.touchedKeyId, issued.id);
    },
  );

  await assert.rejects(
    service.authenticate({
      apiKey: issued.apiKey,
      requiredScope: ApiClientScope.CONTENT_READ,
      siteKey: 'main-blog',
      origin: 'https://blog.example.com',
    }),
    hasCode(ErrorCode.FORBIDDEN),
  );
  await assert.rejects(
    service.authenticate({
      apiKey: issued.apiKey,
      requiredScope: ApiClientScope.SITE_READ,
      siteKey: 'main-blog',
      origin: 'https://other.example.com',
    }),
    hasCode(ErrorCode.FORBIDDEN),
  );

  rateLimiter.allowed = false;
  await assert.rejects(
    service.authenticate({
      apiKey: issued.apiKey,
      requiredScope: ApiClientScope.SITE_READ,
      siteKey: 'main-blog',
      origin: 'https://blog.example.com',
    }),
    hasCode(ErrorCode.RATE_LIMITED),
  );
});

function hasCode(code: ErrorCode) {
  return (error: unknown): boolean => {
    assert.equal(error instanceof DomainError, true);
    assert.equal((error as DomainError).code, code);
    return true;
  };
}
