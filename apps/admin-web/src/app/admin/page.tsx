const overviewCards = [
  {
    label: 'Sites',
    value: '준비 중',
    description: '블로그와 문서 Site를 추가할 수 있는 다음 구현 단위입니다.',
  },
  {
    label: 'Projects',
    value: '준비 중',
    description: '프로젝트 이력과 Repository·Release를 연결합니다.',
  },
  {
    label: 'Deployments',
    value: '준비 중',
    description: 'CI Callback과 Health 상태를 별도로 추적합니다.',
  },
  {
    label: 'Content',
    value: '준비 중',
    description: 'Draft·Revision·Publication을 분리해 관리합니다.',
  },
] as const;

export default function AdminDashboardPage() {
  return (
    <div className="admin-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">DASHBOARD</p>
          <h1>운영 현황</h1>
          <p>
            인증 기반이 준비되었습니다. 다음 단계부터 Site, 프로젝트와 배포 Read Model을
            순서대로 연결합니다.
          </p>
        </div>
        <span className="foundation-badge">Foundation ready</span>
      </header>

      <section className="overview-grid" aria-label="기능 구현 현황">
        {overviewCards.map((card) => (
          <article className="overview-card" key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <p>{card.description}</p>
          </article>
        ))}
      </section>

      <section className="roadmap-panel">
        <div className="panel-toolbar">
          <div>
            <p className="eyebrow">NEXT MILESTONE</p>
            <h2>Workspace · Site · API Client</h2>
          </div>
          <span className="status-pill active">Phase 3</span>
        </div>
        <ol className="roadmap-list">
          <li>
            <strong>Workspace Bootstrap</strong>
            <span>개인 운영 범위의 기본 Workspace를 생성합니다.</span>
          </li>
          <li>
            <strong>Multi Site</strong>
            <span>블로그, 개발 로그와 문서 Site를 독립적으로 관리합니다.</span>
          </li>
          <li>
            <strong>Scoped API Client</strong>
            <span>Site별 읽기 권한만 가진 Delivery API Key를 발급합니다.</span>
          </li>
        </ol>
      </section>
    </div>
  );
}
