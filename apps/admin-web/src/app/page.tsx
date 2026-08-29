type ReadyResponse = {
  status: 'up' | 'down';
  checks: Record<string, { status: 'up' | 'down'; message?: string }>;
  timestamp: string;
};

async function loadApiHealth(): Promise<ReadyResponse | null> {
  const apiBaseUrl =
    process.env.ATLAS_API_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_ATLAS_API_URL ??
    'http://localhost:4000/api';

  try {
    const response = await fetch(`${apiBaseUrl}/health/ready`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as ReadyResponse;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const health = await loadApiHealth();

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ATLAS CONTROL PLANE</p>
        <h1>관리자 패널 기반 준비 완료</h1>
        <p className="description">
          콘텐츠, Site, 프로젝트, 배포, 자료와 회원 기능을 모듈 단위로 추가할 수 있는 기본
          Monorepo입니다.
        </p>
      </section>

      <section className="grid" aria-label="서비스 상태">
        <article className="card">
          <span>Admin Web</span>
          <strong className="status up">UP</strong>
          <small>Next.js Server Component</small>
        </article>

        <article className="card">
          <span>Atlas API</span>
          <strong className={`status ${health?.status === 'up' ? 'up' : 'down'}`}>
            {health?.status === 'up' ? 'UP' : 'DOWN'}
          </strong>
          <small>{health?.timestamp ?? 'API 연결을 확인하세요.'}</small>
        </article>

        <article className="card">
          <span>Infrastructure</span>
          <strong>
            {health
              ? Object.entries(health.checks)
                  .map(([name, value]) => `${name}:${value.status}`)
                  .join(' · ')
              : 'unknown'}
          </strong>
          <small>PostgreSQL · Redis · MinIO</small>
        </article>
      </section>
    </main>
  );
}
