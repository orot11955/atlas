import type { ApiClientPrincipal } from '@atlas/server';

export interface ApiClientHttpRequest {
  headers: {
    authorization?: string | string[];
    origin?: string | string[];
    'idempotency-key'?: string | string[];
    'if-none-match'?: string | string[];
  };
  params?: Record<string, string | undefined>;
  query?: Record<string, string | string[] | undefined>;
  apiClient?: Readonly<ApiClientPrincipal>;
}

export function readSingleApiClientHeader(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  return Array.isArray(value) && value.length === 1 ? value[0] : undefined;
}
