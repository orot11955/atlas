import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import type { ApiEnvironment } from '@atlas/config';
import {
  AdminSessionEntity,
  AdminSessionService,
  Sha256AdminAuthenticationGrantTokenIssuer,
  Sha256AdminSessionTokenIssuer,
  TypeOrmAdminSessionRepository,
  type AdminSessionRepositoryPort,
  type AdminSessionTokenIssuerPort,
  type AuditService,
  type TransactionRunner,
} from '@atlas/server';

import { PlatformModule } from '../platform/platform.module';
import {
  AUDIT_SERVICE,
  TRANSACTION_RUNNER,
} from '../platform/platform.tokens';
import { AdminCsrfGuard } from './admin-csrf.guard';
import { AdminPermissionGuard } from './admin-permission.guard';
import {
  validateAdminSessionCookieConfiguration,
  type AdminSessionCookieConfiguration,
} from './admin-session.cookies';
import { AdminSessionController } from './admin-session.controller';
import { AdminSessionGuard } from './admin-session.guard';
import {
  ADMIN_SESSION_COOKIE_CONFIGURATION,
  ADMIN_SESSION_REPOSITORY,
  ADMIN_SESSION_SERVICE,
  ADMIN_SESSION_TOKEN_ISSUER,
} from './admin-session.tokens';

@Module({
  imports: [TypeOrmModule.forFeature([AdminSessionEntity]), PlatformModule],
  controllers: [AdminSessionController],
  providers: [
    {
      provide: ADMIN_SESSION_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) =>
        new TypeOrmAdminSessionRepository(dataSource),
    },
    {
      provide: ADMIN_SESSION_TOKEN_ISSUER,
      useFactory: () => new Sha256AdminSessionTokenIssuer(),
    },
    {
      provide: ADMIN_SESSION_COOKIE_CONFIGURATION,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<ApiEnvironment, true>,
      ): Readonly<AdminSessionCookieConfiguration> =>
        validateAdminSessionCookieConfiguration({
          sessionCookieName: config.get('AUTH_SESSION_COOKIE_NAME', {
            infer: true,
          }),
          csrfCookieName: config.get('AUTH_CSRF_COOKIE_NAME', {
            infer: true,
          }),
          secure: config.get('AUTH_COOKIE_SECURE', { infer: true }),
          path: '/',
          sameSite: 'lax',
        }),
    },
    {
      provide: ADMIN_SESSION_SERVICE,
      inject: [
        TRANSACTION_RUNNER,
        ADMIN_SESSION_REPOSITORY,
        ADMIN_SESSION_TOKEN_ISSUER,
        AUDIT_SERVICE,
        ConfigService,
      ],
      useFactory: (
        transactionRunner: TransactionRunner<EntityManager>,
        repository: AdminSessionRepositoryPort<EntityManager>,
        sessionTokenIssuer: AdminSessionTokenIssuerPort,
        auditService: AuditService<EntityManager>,
        config: ConfigService<ApiEnvironment, true>,
      ): AdminSessionService<EntityManager> =>
        new AdminSessionService(
          transactionRunner,
          repository,
          new Sha256AdminAuthenticationGrantTokenIssuer(),
          sessionTokenIssuer,
          auditService,
          config.get('AUTH_LOGIN_FINGERPRINT_PEPPER', { infer: true }),
          config.get('AUTH_SESSION_FINGERPRINT_PEPPER', { infer: true }),
          {
            idleTtlMs:
              config.get('AUTH_SESSION_IDLE_SECONDS', { infer: true }) *
              1_000,
            absoluteTtlMs:
              config.get('AUTH_SESSION_ABSOLUTE_SECONDS', {
                infer: true,
              }) * 1_000,
            touchIntervalMs:
              config.get('AUTH_SESSION_TOUCH_SECONDS', { infer: true }) *
              1_000,
            maximumActiveSessions: config.get('AUTH_SESSION_MAX_ACTIVE', {
              infer: true,
            }),
            bindClientAddress: config.get('AUTH_SESSION_BIND_IP', {
              infer: true,
            }),
          },
        ),
    },
    AdminSessionGuard,
    AdminCsrfGuard,
    AdminPermissionGuard,
  ],
  exports: [
    ADMIN_SESSION_SERVICE,
    AdminSessionGuard,
    AdminCsrfGuard,
    AdminPermissionGuard,
  ],
})
export class AdminSessionModule {}
