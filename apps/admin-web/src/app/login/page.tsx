import { redirect } from 'next/navigation';

import { LoginFlow } from '../../features/auth/login-flow';
import { loadServerAdminSession } from '../../features/auth/server-session';

export default async function LoginPage() {
  const session = await loadServerAdminSession();

  if (session) {
    redirect('/admin');
  }

  return (
    <main className="auth-shell">
      <section className="auth-context" aria-label="Atlas 소개">
        <p className="eyebrow">ONE CONTROL PLANE</p>
        <h2>개인 운영 정보를 한 곳에서 관리합니다.</h2>
        <p>
          콘텐츠 발행, 프로젝트 이력, 배포 상태, 개인 자료와 회원 운영을 Site 단위로 연결하는 관리자
          시스템입니다.
        </p>
        <dl className="auth-principles">
          <div>
            <dt>Multi Site</dt>
            <dd>블로그와 문서 Site를 독립적으로 확장</dd>
          </div>
          <div>
            <dt>Secure by default</dt>
            <dd>Password, MFA, Session과 CSRF 경계 적용</dd>
          </div>
          <div>
            <dt>Operational history</dt>
            <dd>게시·배포·회원 작업의 변경 이력 추적</dd>
          </div>
        </dl>
      </section>

      <section className="auth-form-stage" aria-label="관리자 로그인">
        <LoginFlow />
      </section>
    </main>
  );
}
