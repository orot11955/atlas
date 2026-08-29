import { DomainError, ErrorCode } from '../../../core/errors';

export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_MAX_LENGTH = 128;

export function assertAdminPasswordPolicy(password: string): void {
  const length = Array.from(password).length;
  const reasons: string[] = [];

  if (length < ADMIN_PASSWORD_MIN_LENGTH) {
    reasons.push('too-short');
  }

  if (length > ADMIN_PASSWORD_MAX_LENGTH) {
    reasons.push('too-long');
  }

  if (password.trim().length === 0) {
    reasons.push('blank');
  }

  if (password.includes('\u0000')) {
    reasons.push('contains-null');
  }

  if (reasons.length > 0) {
    throw new DomainError({
      code: ErrorCode.ADMIN_PASSWORD_POLICY_FAILED,
      message: 'Admin password does not satisfy the password policy.',
      details: {
        field: 'password',
        minLength: ADMIN_PASSWORD_MIN_LENGTH,
        maxLength: ADMIN_PASSWORD_MAX_LENGTH,
        reasons,
      },
    });
  }
}
