import type { ReactNode } from 'react';

export interface StatePanelProps {
  eyebrow: string;
  title: string;
  description: string;
  tone?: 'neutral' | 'loading' | 'error';
  requestId?: string;
  action?: ReactNode;
}

export function StatePanel({
  eyebrow,
  title,
  description,
  tone = 'neutral',
  requestId,
  action,
}: StatePanelProps) {
  return (
    <section
      className="state-panel"
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      <p className="state-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="state-description">{description}</p>
      {requestId ? <code className="request-id">Request ID: {requestId}</code> : null}
      {action ? <div className="state-action">{action}</div> : null}
    </section>
  );
}
