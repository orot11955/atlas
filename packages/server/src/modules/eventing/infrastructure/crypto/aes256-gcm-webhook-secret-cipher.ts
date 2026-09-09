import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { EncryptedWebhookSecret } from '../../ports/webhook-secret-cipher.port';
import type { WebhookKeyringPort } from '../../ports/webhook-key-maintenance.port';

const ALGORITHM = 'aes-256-gcm';
const FORMAT_VERSION = 'w1';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export class Aes256GcmWebhookSecretCipher implements WebhookKeyringPort {
  // Private fields keep key bytes out of ordinary JSON serialization and inspection.
  readonly #keys = new Map<string, Buffer>();
  readonly #activeVersion: string;

  public constructor(keyBase64: string, keyVersion: string, decryptKeysJson = '[]') {
    this.#activeVersion = validateKeyVersion(keyVersion);
    this.#keys.set(this.#activeVersion, decodeEncryptionKey(keyBase64));
    for (const entry of parseDecryptKeys(decryptKeysJson)) {
      const version = validateKeyVersion(entry.version);
      const key = decodeEncryptionKey(entry.keyBase64);
      if (this.#keys.has(version) || [...this.#keys.values()].some((value) => value.equals(key))) {
        throw new Error('Webhook key versions and key material must be unique.');
      }
      this.#keys.set(version, key);
    }
  }

  public get activeVersion(): string {
    return this.#activeVersion;
  }

  public get readableVersions(): readonly string[] {
    return Object.freeze([...this.#keys.keys()]);
  }

  public encrypt(secret: string): Readonly<EncryptedWebhookSecret> {
    if (typeof secret !== 'string' || secret.length < 32 || secret.length > 4_096) {
      throw new RangeError('Webhook secret plaintext length is invalid.');
    }

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.#keys.get(this.#activeVersion)!, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    cipher.setAAD(createAdditionalAuthenticatedData(this.#activeVersion));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();

    return Object.freeze({
      encryptedValue: [
        FORMAT_VERSION,
        iv.toString('base64url'),
        authenticationTag.toString('base64url'),
        ciphertext.toString('base64url'),
      ].join('.'),
      keyVersion: this.#activeVersion,
    });
  }

  public decrypt(ciphertext: string, keyVersion: string): string {
    const key = this.#keys.get(keyVersion);
    if (!key) throw new Error('Webhook secret key version is not available.');
    if (typeof ciphertext !== 'string' || ciphertext.length > 32_768) {
      throw new Error('Encrypted Webhook secret is invalid.');
    }

    const [format, ivValue, tagValue, ciphertextValue, extra] = ciphertext.split('.');

    if (
      format !== FORMAT_VERSION ||
      !ivValue ||
      !tagValue ||
      ciphertextValue === undefined ||
      extra !== undefined
    ) {
      throw new Error('Encrypted Webhook secret is invalid.');
    }

    const iv = Buffer.from(ivValue, 'base64url');
    const tag = Buffer.from(tagValue, 'base64url');
    const body = Buffer.from(ciphertextValue, 'base64url');

    if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
      throw new Error('Encrypted Webhook secret is invalid.');
    }

    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });
      // The stored version selects both key and historical AAD, never the active version.
      decipher.setAAD(createAdditionalAuthenticatedData(keyVersion));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Encrypted Webhook secret authentication failed.');
    }
  }
}

function decodeEncryptionKey(value: string): Buffer {
  if (typeof value !== 'string' || value.length > 128) {
    throw new RangeError('Webhook encryption key must encode exactly 32 bytes.');
  }
  const normalized = value.trim();
  const key = Buffer.from(normalized, 'base64');

  if (
    key.length !== 32 ||
    key.toString('base64').replace(/=+$/u, '') !== normalized.replace(/=+$/u, '')
  ) {
    throw new RangeError('WEBHOOK_SECRET_ENCRYPTION_KEY_BASE64 must encode exactly 32 bytes.');
  }

  return key;
}

function validateKeyVersion(value: string): string {
  if (typeof value !== 'string') throw new RangeError('Webhook encryption key version is invalid.');
  const normalized = value.trim();

  if (normalized.length < 1 || normalized.length > 64 || !/^[A-Za-z0-9._-]+$/u.test(normalized)) {
    throw new RangeError('WEBHOOK_SECRET_ENCRYPTION_KEY_VERSION is invalid.');
  }

  return normalized;
}

function createAdditionalAuthenticatedData(keyVersion: string): Buffer {
  return Buffer.from(`atlas.webhook-secret\u0000${keyVersion}`, 'utf8');
}

function parseDecryptKeys(value: string): readonly { version: string; keyBase64: string }[] {
  let entries: unknown;
  try {
    if (typeof value !== 'string' || value.length > 8_192) throw new Error('Invalid key list.');
    entries = JSON.parse(value);
  } catch {
    throw new Error('WEBHOOK_SECRET_DECRYPT_KEYS_JSON must be a bounded JSON key list.');
  }
  if (!Array.isArray(entries) || entries.length > 8) {
    throw new Error('Webhook keyring accepts at most eight additional decrypt keys.');
  }
  return (entries as unknown[]).map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Webhook decrypt key entry is invalid.');
    }
    const record = entry as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2 ||
      typeof record.version !== 'string' ||
      typeof record.keyBase64 !== 'string'
    ) {
      throw new Error('Webhook decrypt key entry requires version and keyBase64 only.');
    }
    return { version: record.version, keyBase64: record.keyBase64 };
  });
}
