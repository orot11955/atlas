import Link from 'next/link';

import { StatePanel } from '../components/feedback';

export default function NotFoundPage() {
  return (
    <main className="shell state-shell">
      <StatePanel
        eyebrow="NOT FOUND"
        title="요청한 화면을 찾을 수 없습니다"
        description="주소가 변경되었거나 접근할 수 없는 관리 화면입니다."
        action={
          <Link className="state-button" href="/">
            Dashboard로 이동
          </Link>
        }
      />
    </main>
  );
}
