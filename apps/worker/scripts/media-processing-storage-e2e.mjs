import { Client } from 'minio';
import sharp from 'sharp';

const endpoint = new URL(requiredEnvironment('MINIO_ENDPOINT'));
const privateBucket = requiredEnvironment('MINIO_PRIVATE_BUCKET');
const processingBucket = requiredEnvironment('MINIO_PROCESSING_BUCKET');
const publicBucket = requiredEnvironment('MINIO_PUBLIC_BUCKET');
const client = new Client({
  endPoint: endpoint.hostname,
  port: endpoint.port ? Number(endpoint.port) : endpoint.protocol === 'https:' ? 443 : 9000,
  useSSL: endpoint.protocol === 'https:',
  accessKey: requiredEnvironment('MINIO_ACCESS_KEY'),
  secretKey: requiredEnvironment('MINIO_SECRET_KEY'),
});

const privateObjects = await listObjects(privateBucket);
const processingObjects = await listObjects(processingBucket);
const publicObjects = await listObjects(publicBucket);
const expectedFiles = ['avif-1920.avif', 'webp-1280.webp', 'webp-320.webp', 'webp-768.webp'];

assertEqual(privateObjects.length, 1, 'Private original Object count');
assertEqual(processingObjects.length, 0, 'Processing Object count');
assertEqual(publicObjects.length, expectedFiles.length, 'Public Variant Object count');

if (
  !privateObjects[0]?.name?.endsWith('/original') ||
  privateObjects[0].name.includes('/uploads/')
) {
  throw new Error('Private bucket does not contain exactly one finalized original Object.');
}

const actualFiles = publicObjects
  .map((object) => object.name?.split('/').at(-1))
  .filter(Boolean)
  .sort();
assertEqual(JSON.stringify(actualFiles), JSON.stringify(expectedFiles), 'Public Variant keys');

for (const object of publicObjects) {
  const objectKey = object.name;

  if (!objectKey || !objectKey.startsWith('assets/') || !objectKey.includes('/variants/')) {
    throw new Error('Public bucket contains an invalid Variant Object key.');
  }

  const body = await readObject(publicBucket, objectKey);
  const stat = await client.statObject(publicBucket, objectKey);
  const metadata = await sharp(body).metadata();
  const expectedFormat = objectKey.endsWith('.avif') ? 'heif' : 'webp';
  const expectedContentType = objectKey.endsWith('.avif') ? 'image/avif' : 'image/webp';
  const contentType = readMetadata(stat.metaData, 'content-type');

  assertEqual(metadata.format, expectedFormat, `Decoded format for ${objectKey}`);
  assertEqual(contentType, expectedContentType, `Content-Type for ${objectKey}`);

  if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
    throw new Error(`Public Variant ${objectKey} has invalid image metadata.`);
  }

  if (metadata.exif || metadata.xmp || metadata.iptc) {
    throw new Error(`Public Variant ${objectKey} retained private metadata.`);
  }
}

async function listObjects(bucket) {
  const objects = [];
  const stream = client.listObjectsV2(bucket, '', true);

  await new Promise((resolve, reject) => {
    stream.on('data', (object) => objects.push(object));
    stream.on('error', reject);
    stream.on('end', resolve);
  });

  return objects;
}

async function readObject(bucket, objectKey) {
  const stream = await client.getObject(bucket, objectKey);
  const chunks = [];

  for await (const value of stream) {
    chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  }

  return Buffer.concat(chunks);
}

function readMetadata(metadata, key) {
  return Object.entries(metadata ?? {}).find(([name]) => name.toLowerCase() === key)?.[1];
}

function requiredEnvironment(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}.`);
  }
}
