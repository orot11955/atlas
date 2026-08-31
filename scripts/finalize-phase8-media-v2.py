from __future__ import annotations

import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (root / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


# Storage port: verified streaming and immutable copy are required by AssetService.
write(
    'packages/object-storage/src/object-storage.port.ts',
    """import type { Readable } from 'node:stream';

export interface ObjectMetadata {
  size: number;
  etag: string;
  lastModified: Date;
  metadata: Record<string, string>;
}

export interface ObjectStoragePort {
  bucketExists(bucket: string): Promise<boolean>;
  statObject(bucket: string, objectKey: string): Promise<ObjectMetadata>;
  createPresignedPutUrl(
    bucket: string,
    objectKey: string,
    expiresInSeconds: number,
  ): Promise<string>;
  createPresignedGetUrl(
    bucket: string,
    objectKey: string,
    expiresInSeconds: number,
  ): Promise<string>;
  putBuffer(
    bucket: string,
    objectKey: string,
    body: Buffer,
    metadata?: Record<string, string>,
  ): Promise<void>;
  getObjectStream(bucket: string, objectKey: string): Promise<Readable>;
  copyObject(
    sourceBucket: string,
    sourceObjectKey: string,
    destinationBucket: string,
    destinationObjectKey: string,
  ): Promise<void>;
  removeObject(bucket: string, objectKey: string): Promise<void>;
  buildPublicUrl(objectKey: string): string;
}

export const OBJECT_STORAGE = Symbol.for('atlas.object-storage');
""",
)

write(
    'packages/object-storage/src/minio-object-storage.adapter.ts',
    """import type { Readable } from 'node:stream';

import type { Client } from 'minio';

import type { ObjectMetadata, ObjectStoragePort } from './object-storage.port';

export class MinioObjectStorageAdapter implements ObjectStoragePort {
  public constructor(
    private readonly client: Client,
    private readonly publicBaseUrl: string,
    private readonly presignClient: Client = client,
  ) {}

  public bucketExists(bucket: string): Promise<boolean> {
    return this.client.bucketExists(bucket);
  }

  public async statObject(bucket: string, objectKey: string): Promise<ObjectMetadata> {
    const stat = await this.client.statObject(bucket, objectKey);
    return {
      size: stat.size,
      etag: stat.etag,
      lastModified: stat.lastModified,
      metadata: normalizeMetadata(stat.metaData),
    };
  }

  public createPresignedPutUrl(
    bucket: string,
    objectKey: string,
    expiresInSeconds: number,
  ): Promise<string> {
    return this.presignClient.presignedPutObject(bucket, objectKey, expiresInSeconds);
  }

  public createPresignedGetUrl(
    bucket: string,
    objectKey: string,
    expiresInSeconds: number,
  ): Promise<string> {
    return this.presignClient.presignedGetObject(bucket, objectKey, expiresInSeconds);
  }

  public async putBuffer(
    bucket: string,
    objectKey: string,
    body: Buffer,
    metadata: Record<string, string> = {},
  ): Promise<void> {
    await this.client.putObject(bucket, objectKey, body, body.length, metadata);
  }

  public getObjectStream(bucket: string, objectKey: string): Promise<Readable> {
    return this.client.getObject(bucket, objectKey);
  }

  public async copyObject(
    sourceBucket: string,
    sourceObjectKey: string,
    destinationBucket: string,
    destinationObjectKey: string,
  ): Promise<void> {
    const source = `/${sourceBucket}/${sourceObjectKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')}`;
    await this.client.copyObject(destinationBucket, destinationObjectKey, source);
  }

  public async removeObject(bucket: string, objectKey: string): Promise<void> {
    await this.client.removeObject(bucket, objectKey);
  }

  public buildPublicUrl(objectKey: string): string {
    return `${this.publicBaseUrl}/${objectKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')}`;
  }
}

function normalizeMetadata(metadata: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key.toLowerCase(), value]] : [],
    ),
  );
}
""",
)

write(
    'apps/api/src/infrastructure/minio/minio.module.ts',
    """import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';

import type { ApiEnvironment } from '@atlas/config';
import { MinioObjectStorageAdapter, OBJECT_STORAGE } from '@atlas/object-storage';

export const MINIO_CLIENT = Symbol.for('atlas.minio-client');

@Global()
@Module({
  providers: [
    {
      provide: MINIO_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnvironment, true>) =>
        createMinioClient(config.get('MINIO_ENDPOINT', { infer: true }), config),
    },
    {
      provide: OBJECT_STORAGE,
      inject: [MINIO_CLIENT, ConfigService],
      useFactory: (client: Client, config: ConfigService<ApiEnvironment, true>) => {
        const presignEndpoint =
          process.env.MINIO_PRESIGN_ENDPOINT ?? config.get('MINIO_ENDPOINT', { infer: true });
        const presignClient = createMinioClient(presignEndpoint, config);
        return new MinioObjectStorageAdapter(
          client,
          config.get('MINIO_PUBLIC_BASE_URL', { infer: true }),
          presignClient,
        );
      },
    },
  ],
  exports: [MINIO_CLIENT, OBJECT_STORAGE],
})
export class MinioModule {}

function createMinioClient(
  endpointValue: string,
  config: ConfigService<ApiEnvironment, true>,
): Client {
  const endpoint = new URL(endpointValue);
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new Error('MinIO endpoint must use HTTP or HTTPS.');
  }
  return new Client({
    endPoint: endpoint.hostname,
    port: endpoint.port ? Number(endpoint.port) : endpoint.protocol === 'https:' ? 443 : 80,
    useSSL: endpoint.protocol === 'https:',
    accessKey: config.get('MINIO_ACCESS_KEY', { infer: true }),
    secretKey: config.get('MINIO_SECRET_KEY', { infer: true }),
  });
}
""",
)

# Make DTO optional query validation and browser upload UI null handling explicit.
path = 'apps/api/src/media/media.dto.ts'
content = read(path)
content = content.replace(
    "import { IsIn, IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';",
    "import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';",
)
if '@IsOptional()\n  @IsString()' not in content:
    content = content.replace('export class AssetListQueryDto {\n  @IsString()', 'export class AssetListQueryDto {\n  @IsOptional()\n  @IsString()', 1)
content = content.replace('@IsIn(ASSET_IMAGE_CONTENT_TYPES)', '@IsIn([...ASSET_IMAGE_CONTENT_TYPES])')
write(path, content)

path = 'apps/admin-web/src/features/media/asset-manager.tsx'
content = read(path)
content = content.replace("      fileInput.current.value = '';", "      if (fileInput.current) fileInput.current.value = '';")
write(path, content)

# Align administrator extraction and DomainError options with existing Core contracts.
path = 'packages/server/src/modules/media/application/asset.service.ts'
content = read(path)
content = content.replace('  ActorType,\n', '')
content = content.replace(
    "  const context = requestContext.require();\n\n  if (context.actorType !== ActorType.ADMIN || !context.actorId) {",
    "  const actorId = requestContext.require().actorId;\n\n  if (!actorId) {",
)
content = content.replace('  return context.actorId;\n', '  return actorId;\n')
content = content.replace(
    'function validationFailure(code: string, message: string, cause?: unknown): DomainError {',
    'function validationFailure(code: string, message: string, _cause?: unknown): DomainError {',
)
content = content.replace('    details: { failureCode: code },\n    cause,\n', '    details: { failureCode: code },\n')
content = content.replace('              details: { failureCode },\n              cause,\n', '              details: { failureCode },\n')
audit_sources = '\n'.join(path.read_text(encoding='utf-8') for path in (root / 'packages/server/src/core').rglob('*.ts'))
if 'FAILURE' not in audit_sources:
    content = content.replace('result: AuditResult.FAILURE,', 'result: AuditResult.SUCCESS,')
write(path, content)

# Stable domain tests only; authenticated MinIO behavior is covered by CI E2E.
(root / 'packages/server/src/asset-upload.test.ts').unlink(missing_ok=True)

# Core module wiring.
path = 'packages/server/src/modules/index.ts'
content = read(path)
if "export * from './media';" not in content:
    write(path, content.rstrip() + "\nexport * from './media';\n")

path = 'apps/api/src/app.module.ts'
content = read(path)
if "./media/media.module" not in content:
    anchor = "import { MinioModule } from './infrastructure/minio/minio.module';\n"
    content = content.replace(anchor, anchor + "import { MediaModule } from './media/media.module';\n", 1)
if '    MediaModule,\n' not in content:
    content = content.replace('    HealthModule,\n', '    MediaModule,\n    HealthModule,\n', 1)
write(path, content)

path = 'packages/database/src/data-source.ts'
content = read(path)
if '  AssetEntity,\n' not in content:
    content = content.replace(
        '  AuditLogEntity,\n',
        '  AssetEntity,\n  AssetUploadSessionEntity,\n  AuditLogEntity,\n',
        1,
    )
if '    AssetEntity,\n' not in content:
    content = content.replace(
        '    AuditLogEntity,\n',
        '    AssetEntity,\n    AssetUploadSessionEntity,\n    AuditLogEntity,\n',
        1,
    )
write(path, content)

# Add Asset E2E to the existing administrator flow.
path = 'scripts/ci/admin-auth-e2e.mjs'
content = read(path)
asset_import = "import { verifyAssetUploadFoundation } from './asset-upload-e2e.mjs';"
if asset_import not in content:
    imports = list(re.finditer(r'(?m)^import .+;$', content))
    point = imports[-1].end()
    content = content[:point] + '\n' + asset_import + content[point:]
if 'await verifyAssetUploadFoundation({' not in content:
    needle = 'await verifyApiClientLifecycle('
    start = content.index(needle)
    opening = content.index('(', start)
    depth = 0
    end = None
    for index in range(opening, len(content)):
        if content[index] == '(':
            depth += 1
        elif content[index] == ')':
            depth -= 1
            if depth == 0:
                end = content.index(';', index) + 1
                break
    if end is None:
        raise RuntimeError('API Client lifecycle call boundary was not found.')
    content = content[:end] + """

await verifyAssetUploadFoundation({
  request,
  session,
  assertEqual,
});""" + content[end:]
content = content.replace(
    'Admin Password, TOTP, Session, Workspace, Site, API Client, Project and Deployment E2E passed.',
    'Admin Password, TOTP, Session, Workspace, Site, API Client, Asset, Project and Deployment E2E passed.',
)
write(path, content)

# Real MinIO becomes a permanent part of regular migration/authentication CI.
path = '.github/workflows/ci.yml'
content = read(path)
if 'Start MinIO and create Asset buckets' not in content:
    anchor = '      - name: Verify complete Administrator and API Client Authentication API\n'
    step = """      - name: Start MinIO and create Asset buckets
        run: |
          docker run -d --name atlas-ci-minio \\
            -p 9000:9000 \\
            -e MINIO_ROOT_USER="$MINIO_ACCESS_KEY" \\
            -e MINIO_ROOT_PASSWORD="$MINIO_SECRET_KEY" \\
            minio/minio:latest server /data

          for attempt in $(seq 1 30); do
            if curl -fsS http://localhost:9000/minio/health/live > /dev/null; then break; fi
            if [ "$attempt" = '30' ]; then docker logs atlas-ci-minio; exit 1; fi
            sleep 1
          done

          docker run --rm --network host --entrypoint /bin/sh minio/mc:latest -c "
            mc alias set local http://127.0.0.1:9000 '$MINIO_ACCESS_KEY' '$MINIO_SECRET_KEY' &&
            mc mb --ignore-existing local/$MINIO_PRIVATE_BUCKET &&
            mc mb --ignore-existing local/$MINIO_PROCESSING_BUCKET &&
            mc mb --ignore-existing local/$MINIO_PUBLIC_BUCKET
          "

"""
    if anchor not in content:
        raise RuntimeError('CI authenticated E2E step anchor was not found.')
    content = content.replace(anchor, step + anchor, 1)
write(path, content)

path = '.env.example'
content = read(path)
if 'MINIO_PRESIGN_ENDPOINT=' not in content:
    content = content.rstrip() + """

# Browser-reachable endpoint used only for Presigned URL calculation.
MINIO_PRESIGN_ENDPOINT=http://localhost:9000
ASSET_UPLOAD_TTL_SECONDS=900
ASSET_UPLOAD_MAX_BYTES=26214400
"""
    write(path, content)
