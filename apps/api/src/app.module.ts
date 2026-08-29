import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { apiEnvironmentSchema, type ApiEnvironment } from '@atlas/config';

import { HealthModule } from './health/health.module';
import { MinioModule } from './infrastructure/minio/minio.module';
import { RedisModule } from './infrastructure/redis/redis.module';
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
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes({
      path: '{*splat}',
      method: RequestMethod.ALL,
    });
  }
}
