import { createHash } from 'node:crypto';

import type {
  AdminLoginRateLimiterPort,
  AdminLoginRateLimitResult,
  ConsumeAdminLoginRateLimitInput,
} from '@atlas/server';

interface RedisCounterClient {
  eval(script: string, numberOfKeys: number, ...arguments_: string[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
}

export interface RedisAdminLoginRateLimiterOptions {
  ipLimit: number;
  accountLimit: number;
  windowSeconds: number;
  keyPrefix?: string;
}

interface CounterResult {
  count: number;
  ttlMilliseconds: number;
}

const INCREMENT_COUNTER_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { count, ttl }
`;

export class RedisAdminLoginRateLimiter implements AdminLoginRateLimiterPort {
  private readonly windowMilliseconds: number;
  private readonly keyPrefix: string;

  public constructor(
    private readonly redis: RedisCounterClient,
    private readonly options: RedisAdminLoginRateLimiterOptions,
  ) {
    assertPositiveInteger(options.ipLimit, 'ipLimit');
    assertPositiveInteger(options.accountLimit, 'accountLimit');
    assertPositiveInteger(options.windowSeconds, 'windowSeconds');

    this.windowMilliseconds = options.windowSeconds * 1_000;
    this.keyPrefix = options.keyPrefix ?? 'atlas:admin-login';
  }

  public async consume(
    input: ConsumeAdminLoginRateLimitInput,
  ): Promise<AdminLoginRateLimitResult> {
    const [ipCounter, accountCounter] = await Promise.all([
      this.increment(this.createKey('ip', input.clientAddress)),
      this.increment(this.createKey('account', input.email)),
    ]);
    const ipExceeded = ipCounter.count > this.options.ipLimit;
    const accountExceeded = accountCounter.count > this.options.accountLimit;
    const retryAfterMilliseconds = Math.max(
      ipExceeded ? ipCounter.ttlMilliseconds : 0,
      accountExceeded ? accountCounter.ttlMilliseconds : 0,
    );

    return {
      allowed: !ipExceeded && !accountExceeded,
      retryAfterSeconds:
        retryAfterMilliseconds > 0 ? Math.max(1, Math.ceil(retryAfterMilliseconds / 1_000)) : 0,
    };
  }

  public async resetAccount(email: string): Promise<void> {
    await this.redis.del(this.createKey('account', email));
  }

  private async increment(key: string): Promise<CounterResult> {
    const result = await this.redis.eval(
      INCREMENT_COUNTER_SCRIPT,
      1,
      key,
      String(this.windowMilliseconds),
    );

    if (!Array.isArray(result) || result.length < 2) {
      throw new Error('Redis returned an invalid login rate-limit response.');
    }

    const count = Number(result[0]);
    const ttlMilliseconds = Number(result[1]);

    if (!Number.isSafeInteger(count) || !Number.isFinite(ttlMilliseconds)) {
      throw new Error('Redis returned an invalid login rate-limit counter.');
    }

    return {
      count,
      ttlMilliseconds: Math.max(0, ttlMilliseconds),
    };
  }

  private createKey(namespace: 'account' | 'ip', value: string): string {
    const fingerprint = createHash('sha256')
      .update(`${namespace}\u0000${value}`, 'utf8')
      .digest('hex');

    return `${this.keyPrefix}:${namespace}:${fingerprint}`;
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${field} must be a positive safe integer.`);
  }
}
