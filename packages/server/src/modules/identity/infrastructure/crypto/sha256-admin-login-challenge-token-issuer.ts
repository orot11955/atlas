import { createHash, randomBytes } from 'node:crypto';

import { createUuidV7 } from '../../../../core/ids';
import type {
  AdminLoginChallengeTokenIssuerPort,
  IssuedAdminLoginChallengeToken,
} from '../../ports/admin-login-challenge-token-issuer.port';

export class Sha256AdminLoginChallengeTokenIssuer implements AdminLoginChallengeTokenIssuerPort {
  public issue(issuedAt: Date): Readonly<IssuedAdminLoginChallengeToken> {
    const id = createUuidV7(issuedAt.getTime());
    const secret = randomBytes(32).toString('base64url');
    const token = `atlas_mfa_${id}.${secret}`;
    const tokenDigest = createHash('sha256').update(token, 'utf8').digest('hex');

    return Object.freeze({ id, token, tokenDigest });
  }
}
