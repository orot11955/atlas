import { DomainError, ErrorCode, isUuidV7 } from '../../../core';
import type { ContentSiteScheduleTarget, PublicationScheduleRecord } from './eventing';

/** Legacy rows may lack a target. They remain readable/cancellable, never executable. */
export interface TargetedPublicationScheduleRecord extends PublicationScheduleRecord {
  targetPublicationId?: string;
}

export type ScheduledPublicationTarget =
  | Readonly<{ action: 'publish'; revisionId: string; revisionNumber: number }>
  | Readonly<{ action: 'withdraw'; targetPublicationId: string }>;

export function capturePublicationScheduleTarget(
  target: Readonly<ContentSiteScheduleTarget>,
  action: 'publish' | 'withdraw',
): ScheduledPublicationTarget {
  return readPublicationScheduleTarget({
    action,
    revisionId: action === 'publish' ? target.readyRevisionId : undefined,
    revisionNumber: action === 'publish' ? target.readyRevisionNumber : undefined,
    targetPublicationId: action === 'withdraw' ? target.activePublicationId : undefined,
  });
}

export function readPublicationScheduleTarget(
  record: Readonly<Pick<TargetedPublicationScheduleRecord,
    'action' | 'revisionId' | 'revisionNumber' | 'targetPublicationId'>>,
): ScheduledPublicationTarget {
  if (
    record.action === 'publish' &&
    typeof record.revisionId === 'string' && isUuidV7(record.revisionId) &&
    Number.isSafeInteger(record.revisionNumber) && Number(record.revisionNumber) > 0 &&
    record.targetPublicationId == null
  ) {
    return Object.freeze({ action: 'publish', revisionId: record.revisionId,
      revisionNumber: Number(record.revisionNumber) });
  }
  if (
    record.action === 'withdraw' &&
    typeof record.targetPublicationId === 'string' && isUuidV7(record.targetPublicationId) &&
    record.revisionId == null && record.revisionNumber == null
  ) {
    return Object.freeze({ action: 'withdraw', targetPublicationId: record.targetPublicationId });
  }
  throw new DomainError({
    code: ErrorCode.INVALID_STATE_TRANSITION,
    message: 'Publication schedule has no valid pinned target. Cancel and recreate the schedule.',
  });
}

export interface PublicationScheduleEffectReceipt {
  scheduleId: string;
  workspaceId: string;
  contentId: string;
  contentSiteId: string;
  siteId: string;
  target: ScheduledPublicationTarget;
  publicationId: string;
  outcome: 'published' | 'already-published' | 'withdrawn' | 'already-inactive';
  recordedAt: Date;
}
