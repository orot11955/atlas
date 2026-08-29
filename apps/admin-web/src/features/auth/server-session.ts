import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import type { AdminSession, ApiEnvelope } from './auth-types';

export async function loadServerAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map(({ name, value }) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
  const apiBaseUrl = (
    process.env.ATLAS_API_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_ATLAS_API_URL ??
    'http://localhost:4000/api'
  ).replace(/\/+$/u, '');
  let response: Response;

  try {
    response = await fetch(`${apiBaseUrl}/admin/v1/auth/session`, {
      cache: 'no-store',
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    });
  } catch (cause) {
    throw new Error('Atlas API에서 관리자 Session을 확인할 수 없습니다.', {
      cause,
    });
  }

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`관리자 Session 확인 요청이 ${response.status} 상태로 실패했습니다.`);
  }

  const payload = (await response.json()) as ApiEnvelope<AdminSession>;
  return payload.data;
}

export async function requireServerAdminSession(): Promise<AdminSession> {
  const session = await loadServerAdminSession();

  if (!session) {
    redirect('/login');
  }

  return session;
}
