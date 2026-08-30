export interface ApiClientRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface ApiClientRateLimiterPort {
  consume(
    apiClientId: string,
    limitPerMinute: number,
    now: Date,
  ): Promise<Readonly<ApiClientRateLimitResult>>;
}
