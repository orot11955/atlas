import { randomBytes } from 'node:crypto';

const MAX_UUID_V7_TIMESTAMP = 0xffffffffffff;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createUuidV7(timestampMilliseconds: number = Date.now()): string {
  if (
    !Number.isInteger(timestampMilliseconds) ||
    timestampMilliseconds < 0 ||
    timestampMilliseconds > MAX_UUID_V7_TIMESTAMP
  ) {
    throw new RangeError('UUIDv7 timestamp must be an integer between 0 and 2^48 - 1.');
  }

  const bytes = new Uint8Array(16);
  let timestamp = BigInt(timestampMilliseconds);

  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }

  const random = randomBytes(10);
  const randomByte = (index: number): number => random[index] ?? 0;

  bytes[6] = 0x70 | (randomByte(0) & 0x0f);
  bytes[7] = randomByte(1);
  bytes[8] = 0x80 | (randomByte(2) & 0x3f);

  for (let index = 9; index < bytes.length; index += 1) {
    bytes[index] = randomByte(index - 6);
  }

  const hex = Buffer.from(bytes).toString('hex');

  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)]
    .join('-')
    .toLowerCase();
}

export function isUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}
