import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { createUuidV7 } from '../../../../core/ids';
import type {
  AdminAuthenticationGrantTokenIssuerPort,
  IssuedAdminAuthenticationGrantToken,
} from '../../ports/admin-authentication-grant-token-issuer.port';

export class Sha256AdminAuthenticationGrantTokenIssuer
  implements AdminAuthenticationGrantTokenIssuerPort
{
  public issue(issuedAt: Date): Readonly<IssuedAdminAuthenticationGrantToken> {
    const id = createUuidV7(issuedAt.getTime());
    const secret = randomBytes(32).toString('base64url');
    const token = `atlas_auth_${id}.${secret}`;

    return Object.freeze({
      id,
      token,
      tokenDigest: this.digest(token),
    });
  }

  public digest(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  public matches(token: string, expectedDigest: string): boolean {
    const actual = Buffer.from(this.digest(token), 'hex');
    const expected = Buffer.from(expectedDigest, 'hex');

    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
