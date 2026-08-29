import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import type { ApiEnvironment } from '@atlas/config';
import {
  AdminAccountEntity,
  AdminLoginAttemptEntity,
  AdminLoginChallengeEntity,
  AdminPasswordLoginService,
  Argon2idPasswordHasher,
  Sha256AdminLoginChallengeTokenIssuer,
  TypeOrmAdminAuthenticationRepository,
  type AdminAuthenticationRepositoryPort,
  type AdminLoginChallengeTokenIssuerPort,
  type AdminLoginRateLimiterPort,
  type AuditService,
  type PasswordHasher,
  type TransactionRunner,
} from '@atlas/server';

import { RedisClientService, RedisModule } from '../infrastructure/redis/redis.module';
import { PlatformModule } from '../platform/platform.module';
import { AUDIT_SERVICE, TRANSACTION_RUNNER } from '../platform/platform.tokens';
import { AdminAuthController } from './admin-auth.controller';
import {
  ADMIN_AUTHENTICATION_REPOSITORY,
  ADMIN_LOGIN_CHALLENGE_TOKEN_ISSUER,
  ADMIN_LOGIN_RATE_LIMITER,
  ADMIN_PASSWORD_HASHER,
  ADMIN_PASSWORD_LOGIN_SERVICE,
} from './admin-auth.tokens';
import { RedisAdminLoginRateLimiter } from './redis-admin-login-rate-limiter';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AdminAccountEntity,
      AdminLoginAttemptEntity,
      AdminLoginChallengeEntity,
    ]),
    RedisModule,
    PlatformModule,
  ],
  controllers: [AdminAuthController],
  providers: [
    {
      provide: ADMIN_AUTHENTICATION_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new TypeOrmAdminAuthenticationRepository(dataSource),
    },
    {
      provide: ADMIN_PASSWORD_HASHER,
      useFactory: () => new Argon2idPasswordHasher(),
    },
    {
      provide: ADMIN_LOGIN_CHALLENGE_TOKEN_ISSUER,
      useFactory: () => new Sha256AdminLoginChallengeTokenIssuer(),
    },
    {
      provide: ADMIN_LOGIN_RATE_LIMITER,
      inject: [RedisClientService, ConfigService],
      useFactory: (redis: RedisClientService, config: ConfigService<ApiEnvironment, true>) =>
        new RedisAdminLoginRateLimiter(redis.client, {
          ipLimit: config.get('AUTH_LOGIN_IP_LIMIT', { infer: true }),
          accountLimit: config.get('AUTH_LOGIN_ACCOUNT_LIMIT', { infer: true }),
          windowSeconds: config.get('AUTH_LOGIN_WINDOW_SECONDS', { infer: true }),
          fingerprintPepper: config.get('AUTH_LOGIN_FINGERPRINT_PEPPER', { infer: true }),
        }),
    },
    {
      provide: ADMIN_PASSWORD_LOGIN_SERVICE,
      inject: [
        TRANSACTION_RUNNER,
        ADMIN_AUTHENTICATION_REPOSITORY,
        ADMIN_PASSWORD_HASHER,
        ADMIN_LOGIN_CHALLENGE_TOKEN_ISSUER,
        ADMIN_LOGIN_RATE_LIMITER,
        AUDIT_SERVICE,
        ConfigService,
      ],
      useFactory: (
        transactionRunner: TransactionRunner<EntityManager>,
        repository: AdminAuthenticationRepositoryPort<EntityManager>,
        passwordHasher: PasswordHasher,
        challengeTokenIssuer: AdminLoginChallengeTokenIssuerPort,
        loginRateLimiter: AdminLoginRateLimiterPort,
        auditService: AuditService<EntityManager>,
        config: ConfigService<ApiEnvironment, true>,
      ) =>
        new AdminPasswordLoginService(
          transactionRunner,
          repository,
          passwordHasher,
          challengeTokenIssuer,
          loginRateLimiter,
          auditService,
          config.get('AUTH_LOGIN_FINGERPRINT_PEPPER', { infer: true }),
          {
            failureThreshold: config.get('AUTH_LOGIN_FAILURE_THRESHOLD', { infer: true }),
            lockDurationMs: config.get('AUTH_LOGIN_LOCK_SECONDS', { infer: true }) * 1_000,
            challengeTtlMs: config.get('AUTH_MFA_CHALLENGE_SECONDS', { infer: true }) * 1_000,
          },
        ),
    },
  ],
})
export class AdminAuthModule {}
