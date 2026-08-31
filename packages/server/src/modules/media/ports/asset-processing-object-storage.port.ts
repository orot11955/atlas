import type { Readable } from 'node:stream';

export interface AssetProcessingStoredObjectMetadata {
  size: number;
  etag: string;
}

export interface AssetProcessingObjectStoragePort {
  bucketExists(bucket: string): Promise<boolean>;
  getObjectStream(bucket: string, objectKey: string): Promise<Readable>;
  putBuffer(
    bucket: string,
    objectKey: string,
    body: Buffer,
    metadata?: Record<string, string>,
  ): Promise<void>;
  copyObject(
    sourceBucket: string,
    sourceObjectKey: string,
    destinationBucket: string,
    destinationObjectKey: string,
  ): Promise<void>;
  statObject(bucket: string, objectKey: string): Promise<AssetProcessingStoredObjectMetadata>;
  removeObject(bucket: string, objectKey: string): Promise<void>;
}
