FILES = {
    'packages/server/src/api-client.test.ts': r'''import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ActorType,
  ApiClientAuthenticationService,
  ApiClientKeyStatus,
  ApiClientScope,
  ApiClientStatus,
  DomainError,
  ErrorCode,
  FixedClock,
  HmacApiClientTokenIssuer,
  SiteStatus,
  normalizeAllowedOrigins,
  normalizeApiClientScopes,
  requestContext,
  type ApiClientAggregate,
  type ApiClientAuthenticationRecord,
  type ApiClientKeyRecord,
  type ApiClientRateLimiterPort,
  type ApiClientRateLimitResult,
  type ApiClientRepositoryPort,
  type InsertApiClientRecordInput,
  type UpdateApiClientRecordInput,
  type UpdateApiClientStatusInput,
} from './index';

class AuthenticationRepository implements ApiClientRepositoryPort<never> {
  public authentication?: ApiClientAuthenticationRecord;
  public touched = 0;

  public async listBySite(): Promise<readonly ApiClientAggregate[]> {
    return [];
  }

  public async findById(): Promise<ApiClientAggregate | undefined> {
    return undefined;
  }

  public async findNameOwner(): Promise<string | undefined> {
    return undefined;
  }

  public async insert(_client: InsertApiClientRecordInput): Promise<void> {
    throw new Error('Not implemented in authentication test.');
  }

  public async update(
    _workspaceId: string,
    _siteId: string,
    _clientId: string,
    _input: UpdateApiClientRecordInput,
  ): Promise<boolean> {
    return false;
  }

  public async updateStatus(
    _workspaceId: string,
    _siteId: string,
    _clientId: string,
    _input: UpdateApiClientStatusInput,
  ): Promise<boolean> {
    return false;
  }

  public async transitionActiveKeys(): Promise<void> {
    throw new Error('Not implemented in authentication test.');
  }

  public async insertKey(): Promise<void> {
    throw new Error('Not implemented in authentication test.');
  }

  public async findKeyForClient(): Promise<ApiClientKeyRecord | undefined> {
    return undefined;
  }

  public async revokeKey(): Promise<boolean> {
    return false;
  }

  public async findAuthenticationRecord(): Promise<
    ApiClientAuthenticationRecord | undefined
  > {
    return this.authentication;
  }

  public async touchUsage(): Promise<void> {
    this.touched += 1;
  }
}

class MemoryRateLimiter implements ApiClientRateLimiterPort {
  public calls = 0;

  public async consume(
    _key: string,
    limit: number,
  ): Promise<Readonly<ApiClientRateLimitResult>> {
    this.calls += 1;
    return {
      allowed: this.calls <= limit,
      remaining: Math.max(0, limit - this.calls),
      retryAfterSeconds: 60,
    };
  }
}

const clock = new FixedClock('2026-08-30T00:00:00.000Z');
const issuer = new HmacApiClientTokenIssuer(
  'atlas-test-api-client-key-pepper-value',
);

function createAuthenticationHarness(rateLimitPerMinute = 2) {
  const repository = new AuthenticationRepository();
  const rateLimiter = new MemoryRateLimiter();
  const issued = issuer.issue(clock.now());
  repository.authentication = {
    client: {
      id: '0199-0000-7000-8000-000000000101',
      workspaceId: '00000000-0000-7000-8000-000000000001',
      siteId: '0199-0000-7000-8000-000000000102',
      name: 'Delivery Client',
      status: ApiClientStatus.ACTIVE,
      allowedOrigins: ['https://blog.example.com'],
      rateLimitPerMinute,
      version: 1,
      createdAt: clock.now(),
      updatedAt: clock.now(),
    },
    key: {
      id: issued.id,
      apiClientId: '0199-0000-7000-8000-000000000101',
      keyPrefix: issued.keyPrefix,
      secretDigest: issued.secretDigest,
      status: ApiClientKeyStatus.ACTIVE,
      notBefore: clock.now(),
      createdAt: clock.now(),
    },
    scopes: [ApiClientScope.SITE_READ],
    site: {
      id: '0199-0000-7000-8000-000000000102',
      key: 'main-blog',
      name: 'Main Blog',
      status: SiteStatus.ACTIVE,
    },
  };
  const service = new ApiClientAuthenticationService(
    repository,
    issuer,
    rateLimiter,
    60_000,
    clock,
  );

  return { repository, rateLimiter, issued, service };
}

test('API Client policy normalizes Scope and exact Origin values', () => {
  assert.deepEqual(
    normalizeApiClientScopes(['site:read', 'content:read', 'site:read']),
    ['content:read', 'site:read'],
  );
  assert.deepEqual(
    normalizeAllowedOrigins([
      'https://BLOG.example.com',
      'https://blog.example.com',
      'http://localhost:3000',
    ]),
    ['http://localhost:3000', 'https://blog.example.com'],
  );
  assert.throws(
    () => normalizeAllowedOrigins(['https://blog.example.com/path']),
    DomainError,
  );
});

test('issued API Client token stores only an HMAC digest and parses its Key ID', () => {
  const issued = issuer.issue(clock.now());
  const parsed = issuer.parse(issued.token);

  assert.match(issued.token, /^atlas_live_/u);
  assert.equal(parsed?.keyId, issued.id);
  assert.equal(issued.secretDigest.includes(issued.token), false);
  assert.equal(
    issuer.matchesSecret(parsed?.secret ?? '', issued.secretDigest),
    true,
  );
});

test('API Client authentication enforces Origin, Site Scope and rate limit', async () => {
  const harness = createAuthenticationHarness(2);

  await requestContext.run(
    {
      requestId: 'api-client-request',
      traceId: 'api-client-trace',
      actorType: ActorType.ANONYMOUS,
    },
    async () => {
      const principal = await harness.service.authenticate({
        authorization: `Bearer ${harness.issued.token}`,
        origin: 'https://blog.example.com',
      });
      harness.service.assertScope(principal, ApiClientScope.SITE_READ);
      harness.service.assertSiteKey(principal, 'main-blog');
      harness.service.enterRequestContext(principal);

      assert.equal(requestContext.require().actorType, ActorType.API_CLIENT);
      assert.equal(requestContext.require().siteId, principal.siteId);
      assert.equal(harness.repository.touched, 1);

      await harness.service.authenticate({
        authorization: `Bearer ${harness.issued.token}`,
        origin: 'https://blog.example.com',
      });

      await assert.rejects(
        harness.service.authenticate({
          authorization: `Bearer ${harness.issued.token}`,
          origin: 'https://blog.example.com',
        }),
        (error: unknown) => {
          assert.equal(error instanceof DomainError, true);
          assert.equal((error as DomainError).code, ErrorCode.RATE_LIMITED);
          return true;
        },
      );
      assert.throws(
        () => harness.service.assertSiteKey(principal, 'other-blog'),
        (error: unknown) => {
          assert.equal(error instanceof DomainError, true);
          assert.equal((error as DomainError).code, ErrorCode.FORBIDDEN);
          return true;
        },
      );
    },
  );
});

test('API Client authentication rejects an Origin outside the allowlist', async () => {
  const harness = createAuthenticationHarness();

  await assert.rejects(
    harness.service.authenticate({
      authorization: `Bearer ${harness.issued.token}`,
      origin: 'https://attacker.example',
    }),
    (error: unknown) => {
      assert.equal(error instanceof DomainError, true);
      assert.equal((error as DomainError).code, ErrorCode.FORBIDDEN);
      return true;
    },
  );
});
''',
}
