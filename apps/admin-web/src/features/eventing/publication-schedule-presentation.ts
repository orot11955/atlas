import type { PublicationSchedule } from './eventing-types';

type ScheduleInput = Pick<PublicationSchedule, 'action' | 'status' | 'target' | 'operations'>;

/** Status and eligibility come from the response, not from the current editor pointers. */
export function presentPublicationSchedule(schedule: Readonly<ScheduleInput>) {
  const target = schedule.target;
  const isRevision = target?.kind === 'revision' && schedule.action === 'publish';
  const isPublication = target?.kind === 'publication' && schedule.action === 'withdraw';
  const resolved = isRevision || isPublication;
  return {
    targetLabel: isRevision
      ? `고정 대상: READY Revision #${target.revisionNumber}`
      : isPublication
        ? '고정 대상: Publication'
        : '고정 대상 없음 · 확인 필요',
    targetId: isRevision ? target.revisionId : isPublication ? target.publicationId : null,
    guidance: resolved
      ? schedule.action === 'publish'
        ? '이후 READY Revision이 바뀌어도 이 예약의 대상은 바뀌지 않습니다.'
        : '대상이 이미 교체되거나 철회되었으면 새 공개본을 중단하지 않습니다.'
      : schedule.status === 'pending'
        ? '대상을 추정해 실행하지 않습니다. 이 예약을 취소한 뒤 대상을 확인하여 새로 예약하세요.'
        : schedule.status === 'failed'
          ? '대상 없는 실패 예약은 재실행할 수 없습니다. 대상을 확인하여 새 예약을 만드세요. 기존 이력은 보존됩니다.'
          : '저장된 고정 대상이 없는 예약 이력입니다. 현재 공개본으로 대체하거나 재실행하지 않습니다.',
    canCancel: schedule.status === 'pending' && schedule.operations?.canCancel === true,
    canRetry:
      schedule.status === 'failed' && resolved && schedule.operations?.canRetry === true,
    needsReview: !resolved,
  };
}
