import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

import type { PasswordHasher } from '../../ports/password-hasher.port';

const ARGON2_VERSION = 19;
const DEFAULT_MEMORY_KIB = 19_456;
const DEFAULT_PASSES = 2;
const DEFAULT_PARALLELISM = 1;
const DEFAULT_SALT_LENGTH = 16;
const DEFAULT_TAG_LENGTH = 32;
const MAX_VERIFY_MEMORY_KIB = 1_048_576;
const MAX_VERIFY_PASSES = 10;
const MAX_VERIFY_PARALLELISM = 16;
const PHC_PATTERN =
  /^\$argon2id\$v=(?<version>\d+)\$m=(?<memory>\d+),t=(?<passes>\d+),p=(?<parallelism>\d+)\$(?<salt>[A-Za-z0-9+/]+)\$(?<digest>[A-Za-z0-9+/]+)$/u;

interface Argon2Parameters {
  memoryKiB: number;
  passes: number;
  parallelism: number;
  tagLength: number;
}

interface ParsedArgon2Hash extends Argon2Parameters {
  salt: Buffer;
  digest: Buffer;
}

export class Argon2idPasswordHasher implements PasswordHasher {
  public async hash(password: string): Promise<string> {
    const salt = randomBytes(DEFAULT_SALT_LENGTH);
    const parameters: Argon2Parameters = {
      memoryKiB: DEFAULT_MEMORY_KIB,
      passes: DEFAULT_PASSES,
      parallelism: DEFAULT_PARALLELISM,
      tagLength: DEFAULT_TAG_LENGTH,
    };
    const digest = await deriveArgon2id(password, salt, parameters);

    return [
      '',
      'argon2id',
      `v=${ARGON2_VERSION}`,
      `m=${parameters.memoryKiB},t=${parameters.passes},p=${parameters.parallelism}`,
      encodeBase64(salt),
      encodeBase64(digest),
    ].join('$');
  }

  public async verify(encodedHash: string, password: string): Promise<boolean> {
    const parsed = parseArgon2idHash(encodedHash);

    if (!parsed) {
      return false;
    }

    try {
      const actual = await deriveArgon2id(password, parsed.salt, parsed);
      return actual.length === parsed.digest.length && timingSafeEqual(actual, parsed.digest);
    } catch {
      return false;
    }
  }
}

function deriveArgon2id(
  password: string,
  salt: Uint8Array,
  parameters: Argon2Parameters,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: Buffer.from(password, 'utf8'),
        nonce: salt,
        parallelism: parameters.parallelism,
        tagLength: parameters.tagLength,
        memory: parameters.memoryKiB,
        passes: parameters.passes,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(Buffer.from(derivedKey));
      },
    );
  });
}

function parseArgon2idHash(value: string): ParsedArgon2Hash | undefined {
  const groups = PHC_PATTERN.exec(value)?.groups;

  if (!groups) {
    return undefined;
  }

  const version = parseInteger(groups.version);
  const memoryKiB = parseInteger(groups.memory);
  const passes = parseInteger(groups.passes);
  const parallelism = parseInteger(groups.parallelism);

  if (
    version !== ARGON2_VERSION ||
    memoryKiB === undefined ||
    passes === undefined ||
    parallelism === undefined ||
    parallelism < 1 ||
    parallelism > MAX_VERIFY_PARALLELISM ||
    memoryKiB < 8 * parallelism ||
    memoryKiB > MAX_VERIFY_MEMORY_KIB ||
    passes < 1 ||
    passes > MAX_VERIFY_PASSES
  ) {
    return undefined;
  }

  const saltValue = groups.salt;
  const digestValue = groups.digest;

  if (!saltValue || !digestValue) {
    return undefined;
  }

  const salt = decodeBase64(saltValue);
  const digest = decodeBase64(digestValue);

  if (salt.length < 16 || salt.length > 64 || digest.length < 16 || digest.length > 64) {
    return undefined;
  }

  return {
    memoryKiB,
    passes,
    parallelism,
    tagLength: digest.length,
    salt,
    digest,
  };
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function encodeBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64').replace(/=+$/u, '');
}

function decodeBase64(value: string): Buffer {
  return Buffer.from(value, 'base64');
}
