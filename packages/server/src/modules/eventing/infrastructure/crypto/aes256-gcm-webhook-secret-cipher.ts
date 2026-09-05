import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type {
  EncryptedWebhookSecret,
  WebhookSecretCipherPort,
} from '../../ports/webhook-secret-cipher.port';

const ALGORITHM = 'aes-256-gcm';
const FORMAT_VERSION = 'w1';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export class Aes256GcmWebhookSecretCipher implements WebhookSecretCipherPort {
  private readonly key: Buffer;
  private readonly keyVersion: string;

  public constructor(keyBase64: string, keyVersion: string) {
    this.key = decodeEncryptionKey(keyBase64);
    this.keyVersion = validateKeyVersion(keyVersion);
  }

  public encrypt(secret: string): Readonly<EncryptedWebhookSecret> {
    if (secret.length < 32 || secret.length > 4_096) {
      throw new RangeError('Webhook secret plaintext length is invalid.');
    }

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    cipher.setAAD(createAdditionalAuthenticatedData(this.keyVersion));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();

    return Object.freeze({
      encryptedValue: [
        FORMAT_VERSION,
        iv.toString('base64url'),
        authenticationTag.toString('base64url'),
        ciphertext.toString('base64url'),
      ].join('.'),
      keyVersion: this.keyVersion,
    });
  }

  public decrypt(ciphertext: string, keyVersion: string): string {
    if (keyVersion !== this.keyVersion) {
      throw new Error('Webhook secret key version is not available.');
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
      const decipher = createDecipheriv(ALGORITHM, this.key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });
      decipher.setAAD(createAdditionalAuthenticatedData(this.keyVersion));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Encrypted Webhook secret authentication failed.');
    }
  }
}

function decodeEncryptionKey(value: string): Buffer {
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
  const normalized = value.trim();

  if (normalized.length < 1 || normalized.length > 64 || !/^[A-Za-z0-9._-]+$/u.test(normalized)) {
    throw new RangeError('WEBHOOK_SECRET_ENCRYPTION_KEY_VERSION is invalid.');
  }

  return normalized;
}

function createAdditionalAuthenticatedData(keyVersion: string): Buffer {
  return Buffer.from(`atlas.webhook-secret\u0000${keyVersion}`, 'utf8');
}
