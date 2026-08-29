import { DomainError, ErrorCode } from '../../../core/errors';

import type { AdminAccountStatus } from './admin-account-status';
import type { AdminRole } from './admin-role';

const ADMIN_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export interface AdminAccount {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: AdminRole;
  status: AdminAccountStatus;
  failedLoginCount: number;
  lockedUntil?: Date;
  passwordChangedAt: Date;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function normalizeAdminEmail(value: string): string {
  const email = value.trim().normalize('NFKC').toLowerCase();

  if (
    email.length === 0 ||
    email.length > 320 ||
    containsControlCharacter(email) ||
    !ADMIN_EMAIL_PATTERN.test(email)
  ) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Admin email must be a valid email address.',
      details: { field: 'email' },
    });
  }

  return email;
}

export function normalizeAdminDisplayName(value: string | undefined): string {
  const displayName = (value ?? 'Owner').trim().normalize('NFKC');

  if (
    displayName.length === 0 ||
    displayName.length > 120 ||
    containsControlCharacter(displayName)
  ) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Admin display name must contain between 1 and 120 characters.',
      details: { field: 'displayName' },
    });
  }

  return displayName;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}
