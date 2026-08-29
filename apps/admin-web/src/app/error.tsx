'use client';

import { StatePanel } from '../components/feedback';
import { AtlasApiError } from '../lib/api';

interface ErrorPageProps {
  error: Error & { digest?: string; requestId?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const apiError = error instanceof AtlasApiError ? error : undefined;
  const requestId = apiError?.requestId ?? error.requestId;

  return (
    <main className="shell state-shell">
      <StatePanel
        eyebrow="ERROR"
        title={apiError?.problem.title ?? '관리 화면을 표시하지 못했습니다'}
        description={
          apiError?.problem.detail ??
          '일시적인 오류가 발생했습니다. 다시 시도하고 계속 실패하면 Request ID를 확인하세요.'
        }
        requestId={requestId}
        tone="error"
        action={
          <button className="state-button" type="button" onClick={reset}>
            다시 시도
          </button>
        }
      />
    </main>
  );
}
