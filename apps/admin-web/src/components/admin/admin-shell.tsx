import type { ReactNode } from 'react';

import { LogoutButton } from '../../features/auth/logout-button';
import type { AdminSession } from '../../features/auth/auth-types';
import { AdminNavigation } from './admin-navigation';

export function AdminShell({
  children,
  session,
}: Readonly<{
  children: ReactNode;
  session: AdminSession;
}>) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark small" aria-hidden="true">
            A
          </span>
          <div>
            <strong>Atlas</strong>
            <small>Control Plane</small>
          </div>
        </div>

        <AdminNavigation />

        <div className="sidebar-session">
          <div>
            <span className="role-badge">{session.role}</span>
            <small title={session.userAgentSummary}>{session.userAgentSummary}</small>
          </div>
          <LogoutButton />
        </div>
      </aside>

      <div className="admin-stage">
        <header className="admin-topbar">
          <div>
            <p className="topbar-eyebrow">PERSONAL OPERATIONS</p>
            <strong>Atlas 관리자 패널</strong>
          </div>
          <div className="session-clock">
            <span>Session 만료</span>
            <strong>{formatDate(session.absoluteExpiresAt)}</strong>
          </div>
        </header>

        <main className="admin-content">{children}</main>
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
