import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import type { ApiEnvironment } from '@atlas/config';
import {
  AdminAccountEntity,
  AdminAuthenticationGrantEntity,
  AdminLoginAttemptEntity,
  AdminLoginChallengeEntity,
  AdminMfaMethodEntity,
  AdminMfaService,
  AdminPasswordLoginService,
  AdminRecoveryCodeEntity,
  Aes256GcmAdminMfaSecretCipher,
  Argon2idPasswordHasher,
  HmacAdminRecoveryCodeIssuer,
  NodeAdminTotpAuthenticator,
  Sha256AdminAuthenticationGrantTokenIssuer,
  Sha256AdminLoginChallengeTokenIssuer,
  TypeOrmAdminAuthenticationRepository,
  TypeOrmAdminMfaRepository,
  type AdminAuthenticationGrantTokenIssuerPort,
  type AdminAuthenticationRepositoryPort,
  type AdminLoginChallengeTokenIssuerPort,
  type AdminLoginRateLimiterPort,
  type AdminMfaRepositoryPort,
  type AdminMfaSecretCipherPort,
  type AdminRecoveryCodeIssuerPort,
  type AdminTotpAuthenticatorPort,
  type AuditService,
  type PasswordHasher,
  type TransactionRunner,
} from '@atlas/server';

import { RedisClientService, RedisModule } from '../infrastructure/redis/redis.module';
import { PlatformModule } from '../platform/platform.module';
import { AUDIT_SERVICE, TRANSACTION_RUNNER } from '../platform/platform.tokens';
import { AdminAuthController } from './admin-auth.controller';
import { AdminMfaController } from './admin-mfa.controller';
import {
  ADMIN_AUTHENTICATION_GRANT_TOKEN_ISSUER,
  ADMIN_AUTHENTICATION_REPOSITORY,
  ADMIN_LOGIN_CHALLENGE_TOKEN_ISSUER,
  ADMIN_LOGIN_RATE_LIMITER,
  ADMIN_MFA_REPOSITORY,
  ADMIN_MFA_SECRET_CIPHER,
  ADMIN_MFA_SERVICE,
  ADMIN_PASSWORD_HASHER,
  ADMIN_PASSWORD_LOGIN_SERVICE,
  ADMIN_RECOVERY_CODE_ISSUER,
  ADMIN_TOTP_AUTHENTICATOR,
} from './admin-auth.tokens';
import { RedisAdminLoginRateLimiter } from './redis-admin-login-rate-limiter';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AdminAccountEntity,
      AdminLoginAttemptEntity,
      AdminLoginChallengeEntity,
      AdminMfaMethodEntity,
      AdminRecoveryCodeEntity,
      AdminAuthenticationGrantEntity,
    ]),
    RedisModule,
    PlatformModule,
  ],
  controllers: [AdminAuthController, AdminMfaController],
  providers: [
    {
      provide: ADMIN_AUTHENTICATION_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new TypeOrmAdminAuthenticationRepository(dataSource),
    },
    {
      provide: ADMIN_MFA_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new TypeOrmAdminMfaRepository(dataSource),
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
      provide: ADMIN_TOTP_AUTHENTICATOR,
      useFactory: () => new NodeAdminTotpAuthenticator(),
    },
    {
      provide: ADMIN_MFA_SECRET_CIPHER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnvironment, true>) =>
        new Aes256GcmAdminMfaSecretCipher(
          config.get('AUTH_MFA_ENCRYPTION_KEY_BASE64', { infer: true }),
          config.get('AUTH_MFA_ENCRYPTION_KEY_VERSION', { infer: true }),
        ),
    },
    {
      provide: ADMIN_RECOVERY_CODE_ISSUER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnvironment, true>) =>
        new HmacAdminRecoveryCodeIssuer(
          config.get('AUTH_MFA_RECOVERY_CODE_PEPPER', { infer: true }),
        ),
    },
    {
      provide: ADMIN_AUTHENTICATION_GRANT_TOKEN_ISSUER,
      useFactory: () => new Sha256AdminAuthenticationGrantTokenIssuer(),
    },
    {
      provide: ADMIN_LOGIN_RATE_LIMITER,
      inject: [RedisClientService, ConfigService],
      useFactory: (redis: RedisClientService, config: ConfigService<ApiEnvironment, true>) =>
        new RedisAdminLoginRateLimiter(redis.client, {
          ipLimit: config.get('AUTH_LOGIN_IP_LIMIT', { infer: true }),
          accountLimit: config.get('AUTH_LOGIN_ACCOUNT_LIMIT', { infer: true }),
          windowSeconds: config.get('AUTH_LOGIN_WINDOW_SECONDS', { infer: true }),
          fingerprintPepper: config.get('AUTH_LOGIN_FINGERPRINT_PEPPER', {
            infer: true,
          }),
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
            failureThreshold: config.get('AUTH_LOGIN_FAILURE_THRESHOLD', {
              infer: true,
            }),
            lockDurationMs: config.get('AUTH_LOGIN_LOCK_SECONDS', { infer: true }) * 1_000,
            challengeTtlMs: config.get('AUTH_MFA_CHALLENGE_SECONDS', { infer: true }) * 1_000,
          },
        ),
    },
    {
      provide: ADMIN_MFA_SERVICE,
      inject: [
        TRANSACTION_RUNNER,
        ADMIN_MFA_REPOSITORY,
        ADMIN_LOGIN_CHALLENGE_TOKEN_ISSUER,
        ADMIN_TOTP_AUTHENTICATOR,
        ADMIN_MFA_SECRET_CIPHER,
        ADMIN_RECOVERY_CODE_ISSUER,
        ADMIN_AUTHENTICATION_GRANT_TOKEN_ISSUER,
        AUDIT_SERVICE,
        ConfigService,
      ],
      useFactory: (
        transactionRunner: TransactionRunner<EntityManager>,
        repository: AdminMfaRepositoryPort<EntityManager>,
        challengeTokenIssuer: AdminLoginChallengeTokenIssuerPort,
        totpAuthenticator: AdminTotpAuthenticatorPort,
        secretCipher: AdminMfaSecretCipherPort,
        recoveryCodeIssuer: AdminRecoveryCodeIssuerPort,
        grantTokenIssuer: AdminAuthenticationGrantTokenIssuerPort,
        auditService: AuditService<EntityManager>,
        config: ConfigService<ApiEnvironment, true>,
      ) =>
        new AdminMfaService(
          transactionRunner,
          repository,
          challengeTokenIssuer,
          totpAuthenticator,
          secretCipher,
          recoveryCodeIssuer,
          grantTokenIssuer,
          auditService,
          config.get('AUTH_LOGIN_FINGERPRINT_PEPPER', { infer: true }),
          {
            issuer: config.get('AUTH_MFA_ISSUER', { infer: true }),
            totpWindowSteps: config.get('AUTH_MFA_WINDOW_STEPS', { infer: true }),
            grantTtlMs: config.get('AUTH_MFA_GRANT_SECONDS', { infer: true }) * 1_000,
            recoveryCodeCount: config.get('AUTH_MFA_RECOVERY_CODE_COUNT', {
              infer: true,
            }),
            failureThreshold: config.get('AUTH_MFA_FAILURE_THRESHOLD', {
              infer: true,
            }),
          },
        ),
    },
  ],
})
export class AdminAuthModule {}
