import { createHmac, randomBytes } from 'node:crypto';

import {
  formatAdminRecoveryCode,
  normalizeAdminRecoveryCode,
} from '../../domain/admin-mfa';
import type {
  AdminRecoveryCodeIssuerPort,
  IssuedAdminRecoveryCode,
} from '../../ports/admin-recovery-code-issuer.port';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 16;

export class HmacAdminRecoveryCodeIssuer implements AdminRecoveryCodeIssuerPort {
  private readonly pepper: Buffer;

  public constructor(pepper: string) {
    if (Buffer.byteLength(pepper, 'utf8') < 32) {
      throw new RangeError('AUTH_MFA_RECOVERY_CODE_PEPPER must contain at least 32 bytes.');
    }

    this.pepper = Buffer.from(pepper, 'utf8');
  }

  public issue(count: number): readonly Readonly<IssuedAdminRecoveryCode>[] {
    if (!Number.isSafeInteger(count) || count < 1 || count > 20) {
      throw new RangeError('Recovery code count must be an integer between 1 and 20.');
    }

    const issued: IssuedAdminRecoveryCode[] = [];
    const seen = new Set<string>();

    while (issued.length < count) {
      const normalized = createNormalizedRecoveryCode();

      if (seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      issued.push({
        code: formatAdminRecoveryCode(normalized),
        digest: this.digest(normalized),
      });
    }

    return Object.freeze(issued.map((entry) => Object.freeze({ ...entry })));
  }

  public digest(code: string): string {
    const normalized = normalizeAdminRecoveryCode(code);

    return createHmac('sha256', this.pepper)
      .update(`atlas.admin-recovery-code\u0000${normalized}`, 'utf8')
      .digest('hex');
  }
}

function createNormalizedRecoveryCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let result = '';

  for (const byte of bytes) {
    result += ALPHABET[byte & 31]!;
  }

  return result;
}
