import type {
  ApiClientRateLimiterPort,
  ApiClientRateLimitResult,
} from '@atlas/server';

interface RedisCounterClient {
  eval(script: string, numberOfKeys: number, ...arguments_: string[]): Promise<unknown>;
}

const INCREMENT_COUNTER_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { count, ttl }
`;

export class RedisApiClientRateLimiter implements ApiClientRateLimiterPort {
  public constructor(
    private readonly redis: RedisCounterClient,
    private readonly keyPrefix = 'atlas:api-client-rate',
  ) {}

  public async consume(
    apiClientId: string,
    limitPerMinute: number,
    now: Date,
  ): Promise<Readonly<ApiClientRateLimitResult>> {
    if (!Number.isSafeInteger(limitPerMinute) || limitPerMinute < 1) {
      throw new RangeError('API Client rate limit must be a positive integer.');
    }

    const minute = Math.floor(now.getTime() / 60_000);
    const remainingMilliseconds =
      60_000 - (now.getTime() % 60_000) + 1_000;
    const result = await this.redis.eval(
      INCREMENT_COUNTER_SCRIPT,
      1,
      `${this.keyPrefix}:${apiClientId}:${minute}`,
      String(remainingMilliseconds),
    );

    if (!Array.isArray(result) || result.length < 2) {
      throw new Error('Redis returned an invalid API Client rate-limit response.');
    }

    const count = Number(result[0]);
    const ttlMilliseconds = Number(result[1]);

    if (!Number.isSafeInteger(count) || !Number.isFinite(ttlMilliseconds)) {
      throw new Error('Redis returned an invalid API Client rate-limit counter.');
    }

    return Object.freeze({
      allowed: count <= limitPerMinute,
      retryAfterSeconds:
        count > limitPerMinute
          ? Math.max(1, Math.ceil(Math.max(0, ttlMilliseconds) / 1_000))
          : 0,
    });
  }
}
