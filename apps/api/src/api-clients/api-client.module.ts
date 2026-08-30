import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import type { ApiEnvironment } from '@atlas/config';
import {
  ApiClientAdministrationService,
  ApiClientAllowedOriginEntity,
  ApiClientAuthenticationService,
  ApiClientEntity,
  ApiClientKeyEntity,
  ApiClientScopeEntity,
  ApiClientSiteAccessEntity,
  HmacApiClientKeyIssuer,
  TypeOrmApiClientRepository,
  type ApiClientKeyIssuerPort,
  type ApiClientRateLimiterPort,
  type ApiClientRepositoryPort,
  type AuditService,
  type TransactionRunner,
} from '@atlas/server';

import { AdminSessionModule } from '../admin-session/admin-session.module';
import { AdminWorkspaceSiteModule } from '../admin-sites/admin-workspace-site.module';
import { RedisClientService, RedisModule } from '../infrastructure/redis/redis.module';
import { PlatformModule } from '../platform/platform.module';
import { AUDIT_SERVICE, TRANSACTION_RUNNER } from '../platform/platform.tokens';
import { AdminApiClientController } from './admin-api-client.controller';
import { ApiClientAuthenticationGuard } from './api-client-auth.guard';
import {
  API_CLIENT_ADMINISTRATION_SERVICE,
  API_CLIENT_AUTHENTICATION_SERVICE,
  API_CLIENT_KEY_ISSUER,
  API_CLIENT_RATE_LIMITER,
  API_CLIENT_REPOSITORY,
} from './api-client.tokens';
import { DeliverySiteController } from './delivery-site.controller';
import { RedisApiClientRateLimiter } from './redis-api-client-rate-limiter';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApiClientEntity,
      ApiClientSiteAccessEntity,
      ApiClientScopeEntity,
      ApiClientAllowedOriginEntity,
      ApiClientKeyEntity,
    ]),
    RedisModule,
    PlatformModule,
    AdminSessionModule,
    AdminWorkspaceSiteModule,
  ],
  controllers: [AdminApiClientController, DeliverySiteController],
  providers: [
    {
      provide: API_CLIENT_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new TypeOrmApiClientRepository(dataSource),
    },
    {
      provide: API_CLIENT_KEY_ISSUER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnvironment, true>) =>
        new HmacApiClientKeyIssuer(config.get('API_KEY_PEPPER', { infer: true })),
    },
    {
      provide: API_CLIENT_RATE_LIMITER,
      inject: [RedisClientService],
      useFactory: (redis: RedisClientService) => new RedisApiClientRateLimiter(redis.client),
    },
    {
      provide: API_CLIENT_ADMINISTRATION_SERVICE,
      inject: [TRANSACTION_RUNNER, API_CLIENT_REPOSITORY, API_CLIENT_KEY_ISSUER, AUDIT_SERVICE],
      useFactory: (
        transactionRunner: TransactionRunner<EntityManager>,
        repository: ApiClientRepositoryPort<EntityManager>,
        keyIssuer: ApiClientKeyIssuerPort,
        auditService: AuditService<EntityManager>,
      ) =>
        new ApiClientAdministrationService(transactionRunner, repository, keyIssuer, auditService),
    },
    {
      provide: API_CLIENT_AUTHENTICATION_SERVICE,
      inject: [
        API_CLIENT_REPOSITORY,
        API_CLIENT_KEY_ISSUER,
        API_CLIENT_RATE_LIMITER,
        ConfigService,
      ],
      useFactory: (
        repository: ApiClientRepositoryPort<EntityManager>,
        keyIssuer: ApiClientKeyIssuerPort,
        rateLimiter: ApiClientRateLimiterPort,
        config: ConfigService<ApiEnvironment, true>,
      ) =>
        new ApiClientAuthenticationService(
          repository,
          keyIssuer,
          rateLimiter,
          config.get('API_KEY_USAGE_TOUCH_SECONDS', { infer: true }) * 1_000,
        ),
    },
    ApiClientAuthenticationGuard,
  ],
  exports: [
    API_CLIENT_ADMINISTRATION_SERVICE,
    API_CLIENT_AUTHENTICATION_SERVICE,
    ApiClientAuthenticationGuard,
  ],
})
export class ApiClientModule {}
