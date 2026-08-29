import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';

import type { ApiEnvironment } from '@atlas/config';
import {
  MinioObjectStorageAdapter,
  OBJECT_STORAGE,
} from '@atlas/object-storage';

@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnvironment, true>) => {
        const endpoint = new URL(config.get('MINIO_ENDPOINT', { infer: true }));

        const client = new Client({
          endPoint: endpoint.hostname,
          port: endpoint.port
            ? Number(endpoint.port)
            : endpoint.protocol === 'https:'
              ? 443
              : 9000,
          useSSL: endpoint.protocol === 'https:',
          accessKey: config.get('MINIO_ACCESS_KEY', { infer: true }),
          secretKey: config.get('MINIO_SECRET_KEY', { infer: true }),
        });

        return new MinioObjectStorageAdapter(
          client,
          config.get('MINIO_PUBLIC_BASE_URL', { infer: true }),
        );
      },
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class MinioModule {}
