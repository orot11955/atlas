'use client';

import { useEffect, useMemo, useState } from 'react';

import { AtlasApiError } from '../../lib/api';
import type { Content, ContentSiteAssignment } from '../content/content-types';
import {
  cancelPublicationSchedule,
  createPublicationSchedule,
  loadPublicationSchedules,
  retryPublicationSchedule,
} from './eventing-api';
import type { PublicationSchedule, PublicationScheduleAction } from './eventing-types';
import styles from './publication-scheduler.module.css';

export function PublicationScheduler({
  content,
  assignment,
}: Readonly<{ content: Content; assignment: ContentSiteAssignment }>) {
  const [schedules, setSchedules] = useState<readonly PublicationSchedule[]>([]);
  const [action, setAction] = useState<PublicationScheduleAction>(
    assignment.activePublication ? 'withdraw' : 'publish',
  );
  const [scheduledLocalAt, setScheduledLocalAt] = useState(defaultLocalDateTime());
  const [timezone, setTimezone] = useState(defaultTimezone());
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const pending = useMemo(
    () => schedules.filter((schedule) => ['pending', 'processing'].includes(schedule.status)),
    [schedules],
  );

  useEffect(() => {
    if (open) void reload();
  }, [open, assignment.id]);

  async function reload() {
    setWorking('load');
    setError(undefined);

    try {
      setSchedules(
        await loadPublicationSchedules({
          contentId: content.id,
          contentSiteId: assignment.id,
          limit: 100,
        }),
      );
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function create() {
    setWorking('create');
    setError(undefined);
    setMessage(undefined);

    try {
      const schedule = await createPublicationSchedule(content.id, assignment.id, {
        action,
        scheduledLocalAt,
        timezone: timezone.trim() || undefined,
      });
      setMessage(`${schedule.action === 'publish' ? '발행' : '게시 중단'} 예약을 생성했습니다.`);
      setScheduledLocalAt(defaultLocalDateTime());
      await reload();
    } catch (caught) {
      setError(readError(caught));
      setWorking(undefined);
    }
  }

  async function cancel(schedule: PublicationSchedule) {
    setWorking(`cancel-${schedule.id}`);
    setError(undefined);
    setMessage(undefined);

    try {
      await cancelPublicationSchedule(schedule.id, schedule.version);
      setMessage('예약을 취소했습니다.');
      await reload();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function retry(schedule: PublicationSchedule) {
    setWorking(`retry-${schedule.id}`);
    setError(undefined);
    setMessage(undefined);

    try {
      await retryPublicationSchedule(schedule.id, schedule.version);
      setMessage('실패한 예약의 재실행을 요청했습니다.');
      await reload();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  return (
    <section className={styles.scheduler}>
      <button className={styles.toggle} type="button" onClick={() => setOpen((value) => !value)}>
        {open ? '예약 닫기' : `발행 예약${pending.length ? ` · ${pending.length}` : ''}`}
      </button>

      {open ? (
        <div className={styles.panel}>
          <div className={styles.header}>
            <div>
              <strong>Publication Scheduling</strong>
              <p>Site Timezone 기준으로 Publish 또는 Withdraw를 예약합니다.</p>
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
                min={minimumLocalDateTime()}
                type="datetime-local"
                value={scheduledLocalAt}
                onChange={(event) => setScheduledLocalAt(event.target.value)}
              />
            </label>
            <label>
              <span>Timezone</span>
              <input
                maxLength={64}
                placeholder="Asia/Seoul"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              />
            </label>
            <button
              className={styles.primary}
              disabled={
                working !== undefined ||
                !scheduledLocalAt ||
                !timezone.trim() ||
                (action === 'publish' && content.readyRevisionNumber === null) ||
                (action === 'withdraw' && !assignment.activePublication)
              }
              type="button"
              onClick={create}
            >
              {working === 'create' ? '예약 중…' : '예약 생성'}
            </button>
          </div>

          <div className={styles.list}>
            {schedules.length === 0 ? <p className={styles.muted}>예약 이력이 없습니다.</p> : null}
            {schedules.map((schedule) => (
              <article key={schedule.id}>
                <div>
                  <strong>{schedule.action.toUpperCase()}</strong>
                  <p>
                    {schedule.scheduledLocalAt} · {schedule.timezone}
                  </p>
                  {schedule.lastError ? (
                    <p className={styles.errorText}>{schedule.lastError}</p>
                  ) : null}
                </div>
                <div className={styles.meta}>
                  <span data-status={schedule.status}>{schedule.status}</span>
                  {schedule.status === 'pending' ? (
                    <button
                      className={styles.secondary}
                      disabled={working !== undefined}
                      type="button"
                      onClick={() => cancel(schedule)}
                    >
                      취소
                    </button>
                  ) : null}
                  {schedule.status === 'failed' ? (
                    <button
                      className={styles.secondary}
                      disabled={working !== undefined}
                      type="button"
                      onClick={() => retry(schedule)}
                    >
                      재실행
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>

          <div aria-live="polite">
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
