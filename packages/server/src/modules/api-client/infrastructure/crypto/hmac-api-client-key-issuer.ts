import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { createUuidV7 } from '../../../../core';
import type {
  ApiClientKeyIssuerPort,
  IssuedApiClientKey,
  ParsedApiClientKey,
} from '../../ports/api-client-key-issuer.port';

const API_KEY_PATTERN =
  /^atlas_live_(?<id>[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(?<secret>[A-Za-z0-9_-]{43})$/u;

export class HmacApiClientKeyIssuer implements ApiClientKeyIssuerPort {
  public constructor(private readonly pepper: string) {
    if (Buffer.byteLength(pepper, 'utf8') < 32) {
      throw new RangeError('API Key Pepper must contain at least 32 bytes.');
    }
  }

  public issue(issuedAt: Date): Readonly<IssuedApiClientKey> {
    const id = createUuidV7(issuedAt.getTime());
    const secret = randomBytes(32).toString('base64url');
    const keyPrefix = `atlas_live_${id}`;

    return Object.freeze({
      id,
      apiKey: `${keyPrefix}.${secret}`,
      keyPrefix,
      secretDigest: this.digest(secret),
    });
  }

  public parse(apiKey: string): Readonly<ParsedApiClientKey> | undefined {
    const groups = API_KEY_PATTERN.exec(apiKey)?.groups;

    if (!groups?.id || !groups.secret) {
      return undefined;
    }

    return Object.freeze({
      id: groups.id,
      keyPrefix: `atlas_live_${groups.id}`,
      secret: groups.secret,
    });
  }

  public matches(apiKey: string, expectedDigest: string): boolean {
    const parsed = this.parse(apiKey);

    if (!parsed) {
      return false;
    }

    const actual = Buffer.from(this.digest(parsed.secret), 'hex');
    const expected = Buffer.from(expectedDigest, 'hex');

    return actual.length === 32 && expected.length === 32 && timingSafeEqual(actual, expected);
  }

  private digest(secret: string): string {
    return createHmac('sha256', this.pepper).update(secret, 'utf8').digest('hex');
  }
}
