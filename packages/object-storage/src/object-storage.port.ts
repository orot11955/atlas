import type { Readable } from 'node:stream';

export const OBJECT_STORAGE = Symbol.for('atlas.object-storage');

export type StoredObjectMetadata = {
  size: number;
  etag: string;
  lastModified: Date;
  metadata: Record<string, string>;
};

export interface ObjectStoragePort {
  bucketExists(bucket: string): Promise<boolean>;
  statObject(bucket: string, objectKey: string): Promise<StoredObjectMetadata>;
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
  getObjectStream(bucket: string, objectKey: string): Promise<Readable>;
  copyObject(
    sourceBucket: string,
    sourceObjectKey: string,
    destinationBucket: string,
    destinationObjectKey: string,
  ): Promise<void>;
  putBuffer(
    bucket: string,
    objectKey: string,
    body: Buffer,
    metadata?: Record<string, string>,
  ): Promise<void>;
  removeObject(bucket: string, objectKey: string): Promise<void>;
  buildPublicUrl(objectKey: string): string;
}
