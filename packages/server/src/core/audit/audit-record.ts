import type { ActorType } from '../request-context';
import type { AuditResult } from './audit-result';

export interface AuditRecord {
  id: string;
  workspaceId?: string;
  siteId?: string;
  actorType: ActorType;
  actorId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  requestId: string;
  traceId: string;
  correlationId?: string;
  result: AuditResult;
  errorCode?: string;
  metadata: Readonly<Record<string, unknown>>;
  occurredAt: Date;
}

export interface RecordAuditInput {
  action: string;
  targetType: string;
  targetId?: string;
  result?: AuditResult;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}
