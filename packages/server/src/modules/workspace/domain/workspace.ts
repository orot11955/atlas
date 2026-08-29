import { DomainError, ErrorCode } from '../../../core';

export const DEFAULT_WORKSPACE_ID = '00000000-0000-7000-8000-000000000001';

export interface WorkspaceRecord {
  id: string;
  key: string;
  name: string;
  timezone: string;
  locale: string;
  isDefault: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateWorkspaceDetails {
  name: string;
  timezone: string;
  locale: string;
}

export function normalizeWorkspaceName(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');

  if (normalized.length < 1 || normalized.length > 120) {
    throw validationError('name', 'Workspace name must contain between 1 and 120 characters.');
  }

  return normalized;
}

export function normalizeWorkspaceTimezone(value: string): string {
  const normalized = value.trim();

  if (normalized.length < 1 || normalized.length > 64) {
    throw validationError('timezone', 'Workspace timezone is invalid.');
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date(0));
  } catch {
    throw validationError('timezone', 'Workspace timezone must be a valid IANA timezone.');
  }

  return normalized;
}

export function normalizeWorkspaceLocale(value: string): string {
  const normalized = value.trim();

  try {
    const locales = Intl.getCanonicalLocales(normalized);

    if (locales.length !== 1 || !locales[0] || locales[0].length > 32) {
      throw new RangeError('invalid locale');
    }

    return locales[0];
  } catch {
    throw validationError('locale', 'Workspace locale must be a valid BCP 47 locale.');
  }
}

function validationError(field: string, message: string): DomainError {
  return new DomainError({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { field },
  });
}
