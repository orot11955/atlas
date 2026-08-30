import type { Clock } from '../../../core';
import { ActorType, DomainError, ErrorCode, requestContext, systemClock } from '../../../core';
import { normalizeSiteKey } from '../../site';
import {
  ApiClientStatus,
  createApiClientAuthenticationError,
  createApiClientForbiddenError,
  isApiClientKeyUsable,
  normalizeAllowedOrigin,
  type ApiClientPrincipal,
  type ApiClientScope,
  type ApiClientType,
} from '../domain/api-client';
import type { ApiClientKeyIssuerPort } from '../ports/api-client-key-issuer.port';
import type { ApiClientRateLimiterPort } from '../ports/api-client-rate-limiter.port';
import type { ApiClientRepositoryPort } from '../ports/api-client.repository';

export interface AuthenticateApiClientInput {
  apiKey: string;
  requiredScope: ApiClientScope;
  requiredType?: ApiClientType;
  siteKey: string;
  origin?: string;
}

export class ApiClientAuthenticationService<TTransaction = unknown> {
  public constructor(
    private readonly repository: ApiClientRepositoryPort<TTransaction>,
    private readonly keyIssuer: ApiClientKeyIssuerPort,
    private readonly rateLimiter: ApiClientRateLimiterPort,
    private readonly usageTouchIntervalMs: number,
    private readonly clock: Clock = systemClock,
  ) {
    if (
      !Number.isSafeInteger(usageTouchIntervalMs) ||
      usageTouchIntervalMs < 1 ||
      usageTouchIntervalMs > 3_600_000
    ) {
      throw new RangeError(
        'API Client usage touch interval must be between 1 and 3600000 milliseconds.',
      );
    }
  }

  public async authenticate(
    input: AuthenticateApiClientInput,
  ): Promise<Readonly<ApiClientPrincipal>> {
    const parsed = this.keyIssuer.parse(input.apiKey);

    if (!parsed) {
      throw createApiClientAuthenticationError();
    }

    const record = await this.repository.findAuthenticationRecord(parsed.id);
    const now = this.clock.now();

    if (
      !record ||
      record.status !== ApiClientStatus.ACTIVE ||
      !this.keyIssuer.matches(input.apiKey, record.key.secretDigest) ||
      !isApiClientKeyUsable(record.key, now)
    ) {
      throw createApiClientAuthenticationError();
    }

    if (input.requiredType && record.type !== input.requiredType) {
      throw createApiClientForbiddenError('API Client type cannot access this endpoint.');
    }

    if (!record.scopes.includes(input.requiredScope)) {
      throw createApiClientForbiddenError('API Client scope cannot access this endpoint.');
    }

    const site = await this.repository.findSiteByKey(
      record.workspaceId,
      normalizeSiteKey(input.siteKey),
    );

    if (!site || site.status !== 'active' || !record.siteIds.includes(site.id)) {
      throw createApiClientForbiddenError('API Client cannot access this Site.');
    }

    this.assertOrigin(record.allowedOrigins, record.requireOrigin, input.origin);
    const rateLimit = await this.rateLimiter.consume(
      record.clientId,
      record.rateLimitPerMinute,
      now,
    );

    if (!rateLimit.allowed) {
      throw new DomainError({
        code: ErrorCode.RATE_LIMITED,
        message: 'API Client request rate limit was exceeded.',
        details: {
          retryAfterSeconds: Math.max(1, rateLimit.retryAfterSeconds),
        },
      });
    }

    await this.repository.touchKeyUsage(
      record.key.id,
      now,
      new Date(now.getTime() - this.usageTouchIntervalMs),
    );

    return Object.freeze({
      apiClientId: record.clientId,
      apiClientKeyId: record.key.id,
      workspaceId: record.workspaceId,
      type: record.type,
      scopes: record.scopes,
      site,
    });
  }

  public enterRequestContext(principal: Readonly<ApiClientPrincipal>): void {
    const current = requestContext.require();
    requestContext.enter({
      ...current,
      actorType: ActorType.API_CLIENT,
      actorId: principal.apiClientId,
      workspaceId: principal.workspaceId,
      siteId: principal.site.id,
    });
  }

  private assertOrigin(
    allowedOrigins: readonly string[],
    requireOrigin: boolean,
    origin?: string,
  ): void {
    if (!origin) {
      if (requireOrigin) {
        throw createApiClientForbiddenError('API Client requires an allowed Origin.');
      }

      return;
    }

    let normalized: string;

    try {
      normalized = normalizeAllowedOrigin(origin);
    } catch {
      throw createApiClientForbiddenError('Request Origin is not allowed.');
    }

    if (!allowedOrigins.includes(normalized)) {
      throw createApiClientForbiddenError('Request Origin is not allowed.');
    }
  }
}
