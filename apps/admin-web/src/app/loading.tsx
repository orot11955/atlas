import { StatePanel } from '../components/feedback';

export default function LoadingPage() {
  return (
    <main className="shell state-shell">
      <StatePanel
        eyebrow="LOADING"
        title="데이터를 불러오는 중입니다"
        description="요청이 완료되면 관리 화면을 표시합니다."
        tone="loading"
      />
    </main>
  );
}
