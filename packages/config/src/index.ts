import { z } from 'zod';

const environmentBoolean = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }

    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

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

const mediaQueueSchema = z.object({
  MEDIA_QUEUE_NAME: z.string().min(1).default('atlas-media'),
});

const mediaProcessingSchema = z.object({
  MEDIA_PROCESSING_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  ASSET_PROCESSING_MAX_INPUT_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(26_214_400)
    .default(26_214_400),
  ASSET_PROCESSING_MAX_OUTPUT_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(26_214_400)
    .default(26_214_400),
  ASSET_PROCESSING_MAX_PIXELS: z.coerce.number().int().min(1).max(100_000_000).default(40_000_000),
  ASSET_PROCESSING_MAX_DIMENSION: z.coerce.number().int().min(1).max(50_000).default(12_000),
  ASSET_PROCESSING_STALE_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
});

const adminAuthenticationSchema = z.object({
  TRUST_PROXY: z.string().default('loopback, linklocal, uniquelocal'),
  AUTH_LOGIN_IP_LIMIT: z.coerce.number().int().min(1).max(10_000).default(30),
  AUTH_LOGIN_ACCOUNT_LIMIT: z.coerce.number().int().min(1).max(10_000).default(10),
  AUTH_LOGIN_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(900),
  AUTH_LOGIN_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(100).default(5),
  AUTH_LOGIN_LOCK_SECONDS: z.coerce.number().int().min(1).max(86_400).default(900),
  AUTH_LOGIN_FINGERPRINT_PEPPER: z.string().min(32),
  AUTH_MFA_CHALLENGE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  AUTH_MFA_ENCRYPTION_KEY_BASE64: z.string().refine(isBase64Encoded32ByteKey, {
    message: 'AUTH_MFA_ENCRYPTION_KEY_BASE64 must encode exactly 32 bytes.',
  }),
  AUTH_MFA_ENCRYPTION_KEY_VERSION: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/u)
    .default('v1'),
  AUTH_MFA_RECOVERY_CODE_PEPPER: z.string().min(32),
  AUTH_MFA_ISSUER: z.string().trim().min(1).max(80).default('Atlas'),
  AUTH_MFA_WINDOW_STEPS: z.coerce.number().int().min(0).max(2).default(1),
  AUTH_MFA_GRANT_SECONDS: z.coerce.number().int().min(30).max(600).default(120),
  AUTH_MFA_RECOVERY_CODE_COUNT: z.coerce.number().int().min(1).max(20).default(10),
  AUTH_MFA_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(20).default(5),
  AUTH_SESSION_FINGERPRINT_PEPPER: z.string().min(32),
  AUTH_SESSION_IDLE_SECONDS: z.coerce.number().int().min(60).max(86_400).default(1_800),
  AUTH_SESSION_ABSOLUTE_SECONDS: z.coerce.number().int().min(300).max(604_800).default(43_200),
  AUTH_SESSION_TOUCH_SECONDS: z.coerce.number().int().min(1).max(3_600).default(60),
  AUTH_SESSION_MAX_ACTIVE: z.coerce.number().int().min(1).max(100).default(5),
  AUTH_SESSION_BIND_IP: environmentBoolean.default(false),
  AUTH_SESSION_COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/u)
    .default('atlas_admin_session'),
  AUTH_CSRF_COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/u)
    .default('atlas_admin_csrf'),
  AUTH_COOKIE_SECURE: environmentBoolean.default(false),
});

const apiClientSchema = z.object({
  API_KEY_PEPPER: z.string().min(32),
  API_KEY_USAGE_TOUCH_SECONDS: z.coerce.number().int().min(1).max(3_600).default(60),
});

export const apiEnvironmentSchema = runtimeSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  ...adminAuthenticationSchema.shape,
  ...apiClientSchema.shape,
  ...mediaQueueSchema.shape,
  ...storageSchema.shape,
});

export const workerEnvironmentSchema = runtimeSchema.extend({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  SYSTEM_QUEUE_NAME: z.string().min(1).default('atlas-system'),
  ...mediaQueueSchema.shape,
  ...mediaProcessingSchema.shape,
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
  const databasePath = parsed.pathname.replace(/^\//u, '');

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

function isBase64Encoded32ByteKey(value: string): boolean {
  const normalized = value.trim();

  try {
    const decoded = Buffer.from(normalized, 'base64');

    return (
      decoded.length === 32 &&
      decoded.toString('base64').replace(/=+$/u, '') === normalized.replace(/=+$/u, '')
    );
  } catch {
    return false;
  }
}
