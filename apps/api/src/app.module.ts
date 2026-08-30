import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { apiEnvironmentSchema, type ApiEnvironment } from '@atlas/config';
import { ATLAS_LOGGER, createAtlasLogger } from '@atlas/server';

import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { AdminSessionModule } from './admin-session/admin-session.module';
import { AdminWorkspaceSiteModule } from './admin-sites/admin-workspace-site.module';
import { ApiClientModule } from './api-clients/api-client.module';
import { HealthModule } from './health/health.module';
import { MinioModule } from './infrastructure/minio/minio.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { HttpLoggingMiddleware } from './middleware/http-logging.middleware';
import { RequestContextMiddleware } from './middleware/request-context.middleware';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: (environment) => apiEnvironmentSchema.parse(environment),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnvironment, true>) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL', { infer: true }),
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: false,
        logging: config.get('NODE_ENV', { infer: true }) === 'development',
      }),
    }),
    RedisModule,
    MinioModule,
    PlatformModule,
    AdminAuthModule,
    AdminSessionModule,
    AdminWorkspaceSiteModule,
    ApiClientModule,
    HealthModule,
  ],
  providers: [
    RequestContextMiddleware,
    HttpLoggingMiddleware,
    {
      provide: ATLAS_LOGGER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnvironment, true>) =>
        createAtlasLogger({
          service: 'atlas-api',
          environment: config.get('NODE_ENV', { infer: true }),
          level: config.get('LOG_LEVEL', { infer: true }),
        }),
    },
  ],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware, HttpLoggingMiddleware).forRoutes({
      path: '{*splat}',
      method: RequestMethod.ALL,
    });
  }
}
