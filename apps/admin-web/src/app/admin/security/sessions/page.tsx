import { SessionManager } from '../../../../features/auth/session-manager';

export default function AdminSessionsPage() {
  return (
    <div className="admin-page">
      <header className="page-heading compact-heading">
        <div>
          <p className="eyebrow">SECURITY</p>
          <h1>활성 Session</h1>
          <p>
            로그인된 브라우저와 만료 상태를 확인하고, 현재 기기를 제외한 Session을 즉시 종료할 수
            있습니다.
          </p>
        </div>
      </header>

      <SessionManager />
    </div>
  );
}
