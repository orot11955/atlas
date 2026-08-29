import { Client } from 'minio';

import type { ObjectStoragePort, StoredObjectMetadata } from './object-storage.port';

export class MinioObjectStorageAdapter implements ObjectStoragePort {
  public constructor(
    private readonly client: Client,
    private readonly publicBaseUrl: string,
  ) {}

  public bucketExists(bucket: string): Promise<boolean> {
    return this.client.bucketExists(bucket);
  }

  public async statObject(bucket: string, objectKey: string): Promise<StoredObjectMetadata> {
    const result = await this.client.statObject(bucket, objectKey);

    return {
      size: result.size,
      etag: result.etag,
      lastModified: result.lastModified,
      metadata: result.metaData ?? {},
    };
  }

  public createPresignedPutUrl(
    bucket: string,
    objectKey: string,
    expiresInSeconds: number,
  ): Promise<string> {
    return this.client.presignedPutObject(bucket, objectKey, expiresInSeconds);
  }

  public createPresignedGetUrl(
    bucket: string,
    objectKey: string,
    expiresInSeconds: number,
  ): Promise<string> {
    return this.client.presignedGetObject(bucket, objectKey, expiresInSeconds);
  }

  public async putBuffer(
    bucket: string,
    objectKey: string,
    body: Buffer,
    metadata: Record<string, string> = {},
  ): Promise<void> {
    await this.client.putObject(bucket, objectKey, body, body.length, metadata);
  }

  public async removeObject(bucket: string, objectKey: string): Promise<void> {
    await this.client.removeObject(bucket, objectKey);
  }

  public buildPublicUrl(objectKey: string): string {
    const encodedKey = objectKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');

    return `${this.publicBaseUrl.replace(/\/$/, '')}/${encodedKey}`;
  }
}
