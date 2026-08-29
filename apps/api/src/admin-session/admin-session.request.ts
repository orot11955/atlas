import type { AdminSessionPrincipal } from '@atlas/server';

export interface AdminSessionHttpRequest {
  headers: {
    cookie?: string;
    'user-agent'?: string | string[];
    'x-csrf-token'?: string | string[];
  };
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
  adminSession?: Readonly<AdminSessionPrincipal>;
}

export function readSingleHeader(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  return Array.isArray(value) && value.length === 1 ? value[0] : undefined;
}
