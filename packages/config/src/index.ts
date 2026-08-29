import { z } from 'zod';

const runtimeSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TZ: z.string().default('Asia/Seoul'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const storageSchema = z.object({
  MINIO_ENDPOINT: z.url(),
  MINIO_ACCESS_KEY: z.string().min(3),
  MINIO_SECRET_KEY: z.string().min(8),
  MINIO_PRIVATE_BUCKET: z.string().min(3).default('atlas-private'),
  MINIO_PROCESSING_BUCKET: z.string().min(3).default('atlas-processing'),
  MINIO_PUBLIC_BUCKET: z.string().min(3).default('atlas-public'),
  MINIO_PUBLIC_BASE_URL: z.url(),
});

const adminAuthenticationSchema = z.object({
  TRUST_PROXY: z.string().default('loopback, linklocal, uniquelocal'),
  AUTH_LOGIN_FINGERPRINT_PEPPER: z.string().min(32),
  AUTH_LOGIN_IP_LIMIT: z.coerce.number().int().min(1).max(10_000).default(30),
  AUTH_LOGIN_ACCOUNT_LIMIT: z.coerce.number().int().min(1).max(10_000).default(10),
  AUTH_LOGIN_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(900),
  AUTH_LOGIN_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(100).default(5),
  AUTH_LOGIN_LOCK_SECONDS: z.coerce.number().int().min(1).max(86_400).default(900),
  AUTH_MFA_CHALLENGE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
});

export const apiEnvironmentSchema = runtimeSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  ...adminAuthenticationSchema.shape,
  ...storageSchema.shape,
});

export const workerEnvironmentSchema = runtimeSchema.extend({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  SYSTEM_QUEUE_NAME: z.string().min(1).default('atlas-system'),
  ...storageSchema.shape,
});

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

export type RedisConnectionOptions = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  tls?: Record<string, never>;
};

export function parseRedisUrl(redisUrl: string): RedisConnectionOptions {
  const parsed = new URL(redisUrl);
  const databasePath = parsed.pathname.replace(/^\//, '');

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: databasePath ? Number(databasePath) : 0,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
  };
}

export function parseOriginList(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
