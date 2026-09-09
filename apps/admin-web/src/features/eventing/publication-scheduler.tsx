'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { AtlasApiError } from '../../lib/api';
import type { Content, ContentSiteAssignment } from '../content/content-types';
import {
  cancelPublicationSchedule,
  createPublicationSchedule,
  loadPublicationSchedules,
  retryPublicationSchedule,
} from './eventing-api';
import type { PublicationSchedule, PublicationScheduleAction } from './eventing-types';
import { presentPublicationSchedule } from './publication-schedule-presentation';
import styles from './publication-scheduler.module.css';

type SchedulerProps = Readonly<{ content: Content; assignment: ContentSiteAssignment }>;

export function PublicationScheduler(props: SchedulerProps) {
  // A different scope must never reuse a previous scope's rows, messages or request lock.
  return (
    <SchedulerPanel
      key={`${props.content.workspaceId}:${props.content.id}:${props.assignment.id}`}
      {...props}
    />
  );
}

function SchedulerPanel({ content, assignment }: SchedulerProps) {
  const [schedules, setSchedules] = useState<readonly PublicationSchedule[]>([]);
  const [action, setAction] = useState<PublicationScheduleAction>(
    assignment.activePublication ? 'withdraw' : 'publish',
  );
  const [scheduledLocalAt, setScheduledLocalAt] = useState(defaultLocalDateTime());
  const [timezone, setTimezone] = useState(defaultTimezone());
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const requestInFlight = useRef(false);
  const panelId = useId();

  const pending = useMemo(
    () => schedules.filter((schedule) => ['pending', 'processing'].includes(schedule.status)),
    [schedules],
  );
  const canCreate =
    loaded &&
    pending.length === 0 &&
    Boolean(scheduledLocalAt && timezone.trim()) &&
    (action === 'publish'
      ? content.readyRevisionNumber !== null
      : Boolean(assignment.activePublication));

  useEffect(() => {
    if (open) void reload();
  }, [open]);

  function begin(operation: string): boolean {
    // React state alone cannot reject two handlers invoked in the same event turn.
    if (requestInFlight.current) return false;
    requestInFlight.current = true;
    setWorking(operation);
    setLoaded(false);
    setError(undefined);
    return true;
  }

  function finish() {
    requestInFlight.current = false;
    setWorking(undefined);
  }

  async function refreshSchedules() {
    const rows = await loadPublicationSchedules({
      contentId: content.id,
      contentSiteId: assignment.id,
      limit: 100,
    });
    setSchedules(rows);
    setLoaded(true);
  }

  async function reload() {
    if (!begin('load')) return;
    try {
      await refreshSchedules();
    } catch (caught) {
      setError(`${readError(caught)} 목록을 확인한 뒤 작업하세요. 새로고침으로 다시 시도하세요.`);
    } finally {
      finish();
    }
  }

  async function mutate(
    operation: string,
    command: () => Promise<PublicationSchedule>,
    successMessage: (schedule: PublicationSchedule) => string,
  ) {
    if (!loaded || !begin(operation)) return;
    setMessage(undefined);
    try {
      try {
        const schedule = await command();
        setMessage(successMessage(schedule));
        if (operation === 'create') setScheduledLocalAt(defaultLocalDateTime());
      } catch (caught) {
        const guidance =
          caught instanceof AtlasApiError && caught.status === 409
            ? ' 예약 상태가 변경되었습니다. 갱신된 목록을 확인한 뒤 다시 시도하세요.'
            : '';
        setError(`${readError(caught)}${guidance}`);
      }
      // Also refresh after a rejected or ambiguous request. Never automatically repeat a write.
      try {
        await refreshSchedules();
      } catch (caught) {
        setError(
          (previous) =>
            `${previous ? `${previous} ` : ''}${readError(caught)} 목록을 확인하지 못했습니다. 새로고침으로 다시 확인하세요.`,
        );
      }
    } finally {
      finish();
    }
  }

  async function create() {
    if (!canCreate) return;
    await mutate(
      'create',
      () =>
        createPublicationSchedule(content.id, assignment.id, {
          action,
          scheduledLocalAt,
          timezone: timezone.trim() || undefined,
        }),
      (schedule) => {
        const confirmed = presentPublicationSchedule(schedule);
        return `예약을 생성했습니다. ${confirmed.targetLabel} · ${confirmed.targetId ?? ''}`;
      },
    );
  }

  async function cancel(schedule: PublicationSchedule) {
    if (!presentPublicationSchedule(schedule).canCancel) return;
    await mutate(
      `cancel-${schedule.id}`,
      () => cancelPublicationSchedule(schedule.id, schedule.version),
      () => '예약을 취소했습니다. 기존 예약 이력은 보존됩니다.',
    );
  }

  async function retry(schedule: PublicationSchedule) {
    if (!presentPublicationSchedule(schedule).canRetry) return;
    await mutate(
      `retry-${schedule.id}`,
      () => retryPublicationSchedule(schedule.id, schedule.version),
      () => '실패한 예약의 고정 대상을 그대로 재실행하도록 요청했습니다.',
    );
  }

  return (
    <section aria-label="발행 예약" className={styles.scheduler}>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className={styles.toggle}
        disabled={working !== undefined}
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? '예약 닫기' : `발행 예약${pending.length ? ` · ${pending.length}` : ''}`}
      </button>

      {open ? (
        <div aria-busy={working !== undefined} className={styles.panel} id={panelId}>
          <div className={styles.header}>
            <div>
              <strong>Publication Scheduling</strong>
              <p>입력한 Timezone 기준으로 발행 또는 게시 중단을 예약합니다.</p>
              <p>서버가 예약을 접수할 때 대상을 고정합니다. 생성 후 아래의 대상 ID를 확인하세요.</p>
            </div>
            <button
              className={styles.secondary}
              disabled={working !== undefined}
              type="button"
              onClick={reload}
            >
              새로고침
            </button>
          </div>

          <div className={styles.form}>
            <label>
              <span>Action</span>
              <select
                disabled={working !== undefined}
                value={action}
                onChange={(event) => setAction(event.target.value as PublicationScheduleAction)}
              >
                <option disabled={content.readyRevisionNumber === null} value="publish">
                  Publish READY Revision
                </option>
                <option disabled={!assignment.activePublication} value="withdraw">
                  Withdraw Active Publication
                </option>
              </select>
            </label>
            <label>
              <span>Local Date/Time</span>
              <input
                disabled={working !== undefined}
                min={minimumLocalDateTime()}
                type="datetime-local"
                value={scheduledLocalAt}
                onChange={(event) => setScheduledLocalAt(event.target.value)}
              />
            </label>
            <label>
              <span>Timezone</span>
              <input
                disabled={working !== undefined}
                maxLength={64}
                placeholder="Asia/Seoul"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              />
            </label>
            <button
              className={styles.primary}
              disabled={working !== undefined || !canCreate}
              type="button"
              onClick={create}
            >
              {working === 'create' ? '예약 중…' : '예약 생성'}
            </button>
          </div>
          {!loaded ? (
            <p className={styles.muted}>예약 목록을 확인하기 전에는 변경할 수 없습니다.</p>
          ) : null}
          {pending.length > 0 ? (
            <p className={styles.muted}>
              진행 중인 예약이 있습니다. 대기 예약을 취소하거나 실행이 끝난 뒤 새로 예약하세요.
            </p>
          ) : null}

          <div className={styles.list}>
            {loaded && schedules.length === 0 ? (
              <p className={styles.muted}>예약 이력이 없습니다.</p>
            ) : null}
            {schedules.map((schedule) => {
              const presentation = presentPublicationSchedule(schedule);
              return (
                <article key={schedule.id} data-schedule-id={schedule.id}>
                  <div>
                    <strong>{schedule.action.toUpperCase()}</strong>
                    <p>
                      {schedule.scheduledLocalAt} · {schedule.timezone}
                    </p>
                    <p
                      className={presentation.needsReview ? styles.errorText : styles.muted}
                      data-schedule-target={schedule.target?.kind ?? 'unresolved'}
                    >
                      {presentation.targetLabel}
                    </p>
                    {presentation.targetId ? <p>{presentation.targetId}</p> : null}
                    <p className={styles.muted}>{presentation.guidance}</p>
                    <p className={styles.muted}>
                      예약 ID: {schedule.id} · 실행 시도 {schedule.attemptCount}회
                    </p>
                    {schedule.failureCode ? (
                      <p className={styles.errorText}>
                        예약 실행에 실패했습니다. 예약 ID로 운영 기록을 확인하세요.
                      </p>
                    ) : null}
                  </div>
                  <div className={styles.meta}>
                    <span data-status={schedule.status}>{schedule.status}</span>
                    {presentation.canCancel ? (
                      <button
                        className={styles.secondary}
                        disabled={working !== undefined || !loaded}
                        type="button"
                        onClick={() => cancel(schedule)}
                      >
                        취소
                      </button>
                    ) : null}
                    {presentation.canRetry ? (
                      <button
                        className={styles.secondary}
                        disabled={working !== undefined || !loaded}
                        type="button"
                        onClick={() => retry(schedule)}
                      >
                        고정 대상 재실행
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>

          <div aria-atomic="true" aria-live="polite" role="status">
            {message ? <p className={styles.success}>{message}</p> : null}
            {error ? <p className={styles.error}>{error}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function defaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function minimumLocalDateTime(): string {
  return toLocalInputValue(new Date(Date.now() + 30_000));
}

function defaultLocalDateTime(): string {
  return toLocalInputValue(new Date(Date.now() + 60 * 60 * 1_000));
}

function toLocalInputValue(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function readError(error: unknown): string {
  if (error instanceof AtlasApiError) {
    return `${error.problem.detail}${error.requestId ? ` · 요청 ID ${error.requestId}` : ''}`;
  }
  return error instanceof Error ? error.message : 'Publication 예약을 처리하지 못했습니다.';
}
