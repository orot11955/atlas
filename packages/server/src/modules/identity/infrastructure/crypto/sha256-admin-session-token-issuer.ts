import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { createUuidV7 } from '../../../../core/ids';
import type {
  AdminSessionTokenIssuerPort,
  IssuedAdminSessionToken,
} from '../../ports/admin-session-token-issuer.port';

const SESSION_TOKEN_PATTERN =
  /^atlas_session_(?<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(?<secret>[A-Za-z0-9_-]{32,128})$/u;

export class Sha256AdminSessionTokenIssuer implements AdminSessionTokenIssuerPort {
  public issue(issuedAt: Date): Readonly<IssuedAdminSessionToken> {
    const id = createUuidV7(issuedAt.getTime());
    const secret = randomBytes(32).toString('base64url');
    const csrfSecret = randomBytes(32).toString('base64url');
    const token = `atlas_session_${id}.${secret}`;
    const csrfToken = `atlas_csrf_${csrfSecret}`;

    return Object.freeze({
      id,
      token,
      tokenDigest: this.digestSessionToken(token),
      csrfToken,
      csrfTokenDigest: this.digestCsrfToken(csrfToken),
    });
  }

  public parseSessionToken(token: string): Readonly<{ id: string }> | undefined {
    const groups = SESSION_TOKEN_PATTERN.exec(token)?.groups;
    return groups?.id ? Object.freeze({ id: groups.id }) : undefined;
  }

  public digestSessionToken(token: string): string {
    return digest(token);
  }

  public matchesSessionToken(token: string, expectedDigest: string): boolean {
    return matchesDigest(this.digestSessionToken(token), expectedDigest);
  }

  public digestCsrfToken(token: string): string {
    return digest(token);
  }

  public matchesCsrfToken(token: string, expectedDigest: string): boolean {
    return matchesDigest(this.digestCsrfToken(token), expectedDigest);
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function matchesDigest(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  return (
    actualBuffer.length === 32 &&
    expectedBuffer.length === 32 &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
