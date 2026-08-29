'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { AtlasApiError } from '../../lib/api';
import {
  loadAdminSessions,
  revokeAdminSession,
  revokeOtherAdminSessions,
} from './auth-api';
import type { AdminSessionListItem } from './auth-types';

export function SessionManager() {
  const router = useRouter();
  const [sessions, setSessions] = useState<readonly AdminSessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);

    try {
      setSessions(await loadAdminSessions());
    } catch (caught) {
      if (caught instanceof AtlasApiError && caught.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }

      setError(readError(caught));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revokeOtherSessions() {
    setWorkingId('others');
    setError(undefined);
    setMessage(undefined);

    try {
      const revokedCount = await revokeOtherAdminSessions();
      setMessage(`${revokedCount}개의 다른 Session을 종료했습니다.`);
      await load();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorkingId(undefined);
    }
  }

  async function revoke(sessionId: string) {
    setWorkingId(sessionId);
    setError(undefined);
    setMessage(undefined);

    try {
      await revokeAdminSession(sessionId);
      setMessage('선택한 Session을 종료했습니다.');
      await load();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorkingId(undefined);
    }
  }

  if (loading) {
    return <div className="panel-empty">활성 Session을 불러오는 중입니다…</div>;
  }

  return (
    <section className="session-panel" aria-label="관리자 Session">
      <div className="panel-toolbar">
        <div>
          <h2>로그인된 기기</h2>
          <p>현재 계정으로 로그인한 최근 Session과 만료 상태를 확인합니다.</p>
        </div>
        <button
          className="secondary-button compact"
          disabled={workingId !== undefined}
          type="button"
          onClick={revokeOtherSessions}
        >
          {workingId === 'others' ? '종료 중…' : '현재 기기 외 모두 종료'}
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="panel-empty">표시할 Session이 없습니다.</div>
      ) : (
        <div className="session-list">
          {sessions.map((session) => (
            <article className="session-item" key={session.id}>
              <div className="session-icon" aria-hidden="true">
                {session.current ? '●' : '○'}
              </div>
              <div className="session-body">
                <div className="session-heading">
                  <strong>{session.userAgentSummary}</strong>
                  <span className={`status-pill ${session.status}`}>
                    {session.current ? '현재 Session' : statusLabel(session.status)}
                  </span>
                </div>
                <dl className="session-meta">
                  <div>
                    <dt>생성</dt>
                    <dd>{formatDate(session.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>최근 활동</dt>
                    <dd>{formatDate(session.lastSeenAt)}</dd>
                  </div>
                  <div>
                    <dt>절대 만료</dt>
                    <dd>{formatDate(session.absoluteExpiresAt)}</dd>
                  </div>
                </dl>
                {session.revokeReason ? (
                  <small className="muted">종료 사유: {session.revokeReason}</small>
                ) : null}
              </div>
              <div className="session-actions">
                {!session.current && session.status === 'active' ? (
                  <button
                    className="danger-button"
                    disabled={workingId !== undefined}
                    type="button"
                    onClick={() => revoke(session.id)}
                  >
                    {workingId === session.id ? '종료 중…' : '종료'}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="panel-feedback" aria-live="polite">
        {message ? <p className="form-message">{message}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </section>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function statusLabel(status: AdminSessionListItem['status']): string {
  switch (status) {
    case 'active':
      return '활성';
    case 'expired':
      return '만료';
    case 'revoked':
      return '종료됨';
  }
}

function readError(error: unknown): string {
  if (error instanceof AtlasApiError) {
    const suffix = error.requestId ? ` · 요청 ID ${error.requestId}` : '';
    return `${error.problem.detail}${suffix}`;
  }

  return 'Session 요청을 처리하지 못했습니다.';
}
