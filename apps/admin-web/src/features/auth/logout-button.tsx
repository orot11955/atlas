'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AtlasApiError } from '../../lib/api';
import { logoutAdminSession } from './auth-api';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function logout() {
    setBusy(true);
    setError(undefined);

    try {
      await logoutAdminSession();
      router.replace('/login');
      router.refresh();
    } catch (caught) {
      setBusy(false);
      setError(
        caught instanceof AtlasApiError
          ? caught.problem.detail
          : '로그아웃 요청을 처리하지 못했습니다.',
      );
    }
  }

  return (
    <div className="logout-control">
      <button className="sidebar-button" disabled={busy} type="button" onClick={logout}>
        {busy ? '종료 중…' : '로그아웃'}
      </button>
      {error ? <small className="sidebar-error">{error}</small> : null}
    </div>
  );
}
