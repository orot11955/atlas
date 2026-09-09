import { ErrorCode, isApplicationError } from '../../../core';
import {
  readPublicationScheduleTarget,
  type TargetedPublicationScheduleRecord,
} from '../domain/scheduled-publication';

export type PublicationScheduleTargetView =
  | Readonly<{ kind: 'revision'; revisionId: string; revisionNumber: number }>
  | Readonly<{ kind: 'publication'; publicationId: string }>
  | Readonly<{ kind: 'unresolved'; reason: 'missing-target' | 'invalid-target' }>;

/** Read the persisted intent only. Never fill legacy targets from live Content pointers. */
export function toPublicationScheduleView(record: Readonly<TargetedPublicationScheduleRecord>) {
  const target = readTarget(record);
  const resolved = target.kind !== 'unresolved';
  return Object.freeze({
    id: record.id,
    workspaceId: record.workspaceId,
    siteId: record.siteId,
    siteKey: record.siteKey ?? null,
    siteName: record.siteName ?? null,
    contentId: record.contentId,
    contentTitle: record.contentTitle ?? null,
    contentSiteId: record.contentSiteId,
    action: record.action,
    // Retain the existing target fields for clients, but normalize missing values to null.
    revisionId: target.kind === 'revision' ? target.revisionId : null,
    revisionNumber: target.kind === 'revision' ? target.revisionNumber : null,
    targetPublicationId: target.kind === 'publication' ? target.publicationId : null,
    target,
    // Eligibility is not authorization. Existing server guards and commands remain authoritative.
    operations: Object.freeze({
      canCancel: record.status === 'pending',
      canRetry: record.status === 'failed' && resolved,
    }),
    scheduledFor: record.scheduledFor.toISOString(),
    scheduledLocalAt: record.scheduledLocalAt,
    timezone: record.timezone,
    status: record.status,
    attemptCount: record.attemptCount,
    nextAttemptAt: record.nextAttemptAt.toISOString(),
    failureCode: record.lastError ? 'execution-failed' : null,
    // Do not expose arbitrary database/adapter exception text through an Admin DTO.
    lastError: record.lastError ? 'Publication schedule execution failed.' : null,
    completedAt: record.completedAt?.toISOString() ?? null,
    cancelledAt: record.cancelledAt?.toISOString() ?? null,
    version: record.version,
    requestedByAdminAccountId: record.requestedByAdminAccountId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function readTarget(
  record: Readonly<TargetedPublicationScheduleRecord>,
): PublicationScheduleTargetView {
  try {
    const target = readPublicationScheduleTarget(record);
    return target.action === 'publish'
      ? Object.freeze({
          kind: 'revision',
          revisionId: target.revisionId,
          revisionNumber: target.revisionNumber,
        })
      : Object.freeze({ kind: 'publication', publicationId: target.targetPublicationId });
  } catch (error) {
    if (!isApplicationError(error) || error.code !== ErrorCode.INVALID_STATE_TRANSITION) {
      throw error;
    }
    const missing =
      record.revisionId == null &&
      record.revisionNumber == null &&
      record.targetPublicationId == null;
    return Object.freeze({
      kind: 'unresolved',
      reason: missing ? 'missing-target' : 'invalid-target',
    });
  }
}
