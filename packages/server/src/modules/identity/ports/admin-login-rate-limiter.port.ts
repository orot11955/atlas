export interface ConsumeAdminLoginRateLimitInput {
  email: string;
  clientAddress: string;
}

export interface AdminLoginRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface AdminLoginRateLimiterPort {
  consume(input: ConsumeAdminLoginRateLimitInput): Promise<AdminLoginRateLimitResult>;
  resetAccount(email: string): Promise<void>;
}
