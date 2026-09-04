'use client';

import { useEffect, useMemo, useState } from 'react';

import { AtlasApiError } from '../../lib/api';
import { PublicationScheduler } from '../eventing/publication-scheduler';
import { loadSites } from '../sites/site-api';
import type { Site } from '../sites/site-types';
import {
  createContentSite,
  loadContentPublications,
  loadContentSites,
  publishContentSite,
  rollbackContentPublication,
  updateContentSite,
  withdrawContentSite,
} from './content-api';
import type {
  Content,
  ContentPublication,
  ContentSiteAssignment,
  ContentSiteVisibility,
} from './content-types';
import { CONTENT_SITE_VISIBILITY_OPTIONS } from './content-types';
import styles from './content.module.css';

export function ContentPublicationManager({ content }: Readonly<{ content: Content }>) {
  const [assignments, setAssignments] = useState<readonly ContentSiteAssignment[]>([]);
  const [sites, setSites] = useState<readonly Site[]>([]);
  const [siteId, setSiteId] = useState('');
  const [slug, setSlug] = useState('');
  const [visibility, setVisibility] = useState<ContentSiteVisibility>('public');
  const [working, setWorking] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void reload();
  }, [content.id]);

  const availableSites = useMemo(() => {
    const assigned = new Set(assignments.map((assignment) => assignment.site.id));
    return sites.filter((site) => site.status !== 'archived' && !assigned.has(site.id));
  }, [assignments, sites]);

  async function reload() {
    setWorking('load-publication');
    setError(undefined);

    try {
      const [nextAssignments, siteResult] = await Promise.all([
        loadContentSites(content.id),
        loadSites({ limit: 100 }),
      ]);
      setAssignments(nextAssignments);
      setSites(siteResult.items);
      setSiteId((current) =>
        current && siteResult.items.some((site) => site.id === current) ? current : '',
      );
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function assign() {
    if (!siteId || !slug.trim()) {
      setError('Site와 Slug를 입력하세요.');
      return;
    }

    setWorking('assign');
    setError(undefined);
    setMessage(undefined);

    try {
      await createContentSite(content.id, {
        siteId,
        slug,
        visibility,
      });
      setSlug('');
      setVisibility('public');
      setSiteId('');
      setMessage('Site 배치를 추가했습니다.');
      await reload();
    } catch (caught) {
      setError(readError(caught));
      setWorking(undefined);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.revisionHeader}>
        <div>
          <h2>Publication</h2>
          <p>
            Site별 설정과 READY Revision을 결합해 불변 Snapshot을 발행합니다. Draft 변경은 현재
            공개본에 영향을 주지 않습니다.
          </p>
        </div>
        <span className={styles.pill} data-status={content.readyRevisionNumber ? 'ready' : 'draft'}>
          READY {content.readyRevisionNumber ?? '-'}
        </span>
      </div>

      {content.status !== 'archived' ? (
        <div className={styles.assignmentForm}>
          <label className={styles.field}>
            <span>Site</span>
            <select value={siteId} onChange={(event) => setSiteId(event.target.value)}>
              <option value="">Site 선택</option>
              {availableSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name} · {site.key} · {site.status}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Slug</span>
            <input
              maxLength={160}
              placeholder="atlas-publication"
              value={slug}
              onChange={(event) => setSlug(event.target.value.toLowerCase())}
            />
          </label>
          <label className={styles.field}>
            <span>Visibility</span>
            <select
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as ContentSiteVisibility)}
            >
              {CONTENT_SITE_VISIBILITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className={styles.button}
            disabled={working !== undefined || !siteId || !slug.trim()}
            type="button"
            onClick={assign}
          >
            {working === 'assign' ? '배치 중…' : 'Site 배치'}
          </button>
        </div>
      ) : null}

      <div className={styles.publicationSites}>
        {assignments.length === 0 ? (
          <div className={styles.empty}>아직 연결된 Site가 없습니다.</div>
        ) : null}
        {assignments.map((assignment) => (
          <ContentSiteCard
            assignment={assignment}
            content={content}
            key={assignment.id}
            onChanged={reload}
          />
        ))}
      </div>

      <div aria-live="polite">
        {message ? <p className={styles.success}>{message}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
      </div>
    </section>
  );
}

function ContentSiteCard({
  assignment,
  content,
  onChanged,
}: Readonly<{
  assignment: ContentSiteAssignment;
  content: Content;
  onChanged: () => Promise<void>;
}>) {
  const [slug, setSlug] = useState(assignment.slug);
  const [titleOverride, setTitleOverride] = useState(assignment.titleOverride ?? '');
  const [summaryOverride, setSummaryOverride] = useState(assignment.summaryOverride ?? '');
  const [visibility, setVisibility] = useState<ContentSiteVisibility>(assignment.visibility);
  const [seoJson, setSeoJson] = useState(JSON.stringify(assignment.seo, null, 2));
  const [history, setHistory] = useState<readonly ContentPublication[]>();
  const [working, setWorking] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setSlug(assignment.slug);
    setTitleOverride(assignment.titleOverride ?? '');
    setSummaryOverride(assignment.summaryOverride ?? '');
    setVisibility(assignment.visibility);
    setSeoJson(JSON.stringify(assignment.seo, null, 2));
  }, [assignment]);

  async function save() {
    setWorking('save');
    setError(undefined);
    setMessage(undefined);

    try {
      await updateContentSite(content.id, assignment.id, {
        version: assignment.version,
        slug,
        titleOverride: titleOverride.trim() || undefined,
        summaryOverride: summaryOverride.trim() || undefined,
        seo: parseSeo(seoJson),
        visibility,
      });
      setMessage('Site별 설정을 저장했습니다.');
      await onChanged();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function publish() {
    setWorking('publish');
    setError(undefined);
    setMessage(undefined);

    try {
      const publication = await publishContentSite(content.id, assignment.id);
      setMessage(`Revision ${publication.revisionNumber}을 발행했습니다.`);
      setHistory(await loadContentPublications(content.id, assignment.id));
      await onChanged();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function withdraw() {
    if (!window.confirm(`${assignment.site.name}의 현재 공개본을 게시 중단할까요?`)) {
      return;
    }

    setWorking('withdraw');
    setError(undefined);
    setMessage(undefined);

    try {
      await withdrawContentSite(content.id, assignment.id);
      setMessage('현재 공개본을 게시 중단했습니다.');
      setHistory(await loadContentPublications(content.id, assignment.id));
      await onChanged();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function toggleHistory() {
    if (history) {
      setHistory(undefined);
      return;
    }

    setWorking('history');
    setError(undefined);

    try {
      setHistory(await loadContentPublications(content.id, assignment.id));
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function rollback(publication: ContentPublication) {
    if (
      !window.confirm(`Revision ${publication.revisionNumber} Snapshot을 새 공개본으로 복구할까요?`)
    ) {
      return;
    }

    setWorking(`rollback-${publication.id}`);
    setError(undefined);
    setMessage(undefined);

    try {
      const restored = await rollbackContentPublication(content.id, assignment.id, publication.id);
      setMessage(`Revision ${restored.revisionNumber} Snapshot을 복구했습니다.`);
      setHistory(await loadContentPublications(content.id, assignment.id));
      await onChanged();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  const canPublish =
    content.status !== 'archived' &&
    content.readyRevisionNumber !== null &&
    assignment.site.status === 'active';

  return (
    <article className={styles.publicationSiteCard}>
      <div className={styles.editorHeader}>
        <div>
          <h3>{assignment.site.name}</h3>
          <p className={styles.muted}>
            {assignment.site.key} · {assignment.site.status}
          </p>
        </div>
        <div className={styles.actions}>
          <span
            className={styles.pill}
            data-status={assignment.activePublication ? 'ready' : 'draft'}
          >
            {assignment.activePublication
              ? `ACTIVE r${assignment.activePublication.revisionNumber}`
              : 'NOT PUBLISHED'}
          </span>
          <span className={styles.pill}>{assignment.visibility}</span>
        </div>
      </div>

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Slug</span>
          <input
            disabled={content.status === 'archived'}
            maxLength={160}
            value={slug}
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
          />
        </label>
        <label className={styles.field}>
          <span>Visibility</span>
          <select
            disabled={content.status === 'archived'}
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as ContentSiteVisibility)}
          >
            {CONTENT_SITE_VISIBILITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={`${styles.field} ${styles.full}`}>
          <span>Title Override</span>
          <input
            disabled={content.status === 'archived'}
            maxLength={200}
            placeholder={content.draft.title}
            value={titleOverride}
            onChange={(event) => setTitleOverride(event.target.value)}
          />
        </label>
        <label className={`${styles.field} ${styles.full}`}>
          <span>Summary Override</span>
          <textarea
            disabled={content.status === 'archived'}
            maxLength={500}
            placeholder={content.draft.summary ?? ''}
            value={summaryOverride}
            onChange={(event) => setSummaryOverride(event.target.value)}
          />
        </label>
        <label className={`${styles.field} ${styles.full}`}>
          <span>SEO JSON</span>
          <textarea
            className={styles.jsonEditor}
            disabled={content.status === 'archived'}
            value={seoJson}
            onChange={(event) => setSeoJson(event.target.value)}
          />
        </label>
      </div>

      <div className={styles.actions}>
        <button
          className={styles.secondary}
          disabled={working !== undefined || content.status === 'archived'}
          type="button"
          onClick={save}
        >
          {working === 'save' ? '저장 중…' : '설정 저장'}
        </button>
        <button
          className={styles.button}
          disabled={working !== undefined || !canPublish}
          title={
            assignment.site.status !== 'active'
              ? 'Site를 Active 상태로 전환해야 합니다.'
              : content.readyRevisionNumber === null
                ? 'READY Revision이 필요합니다.'
                : undefined
          }
          type="button"
          onClick={publish}
        >
          {working === 'publish' ? '발행 중…' : 'READY 발행'}
        </button>
        {assignment.activePublication ? (
          <button
            className={styles.danger}
            disabled={working !== undefined}
            type="button"
            onClick={withdraw}
          >
            {working === 'withdraw' ? '처리 중…' : '게시 중단'}
          </button>
        ) : null}
        <button
          className={styles.secondary}
          disabled={working !== undefined}
          type="button"
          onClick={toggleHistory}
        >
          {working === 'history' ? '불러오는 중…' : history ? '이력 닫기' : '발행 이력'}
        </button>
      </div>

      <PublicationScheduler assignment={assignment} content={content} />

      {history ? (
        <div className={styles.publicationHistory}>
          {history.length === 0 ? <p className={styles.muted}>발행 이력이 없습니다.</p> : null}
          {history.map((publication) => (
            <div className={styles.publicationHistoryItem} key={publication.id}>
              <div>
                <strong>
                  Revision {publication.revisionNumber} · {publication.status}
                </strong>
                <p className={styles.muted}>
                  /{publication.slug} · {publication.visibility} ·{' '}
                  {formatDate(publication.publishedAt)}
                </p>
              </div>
              {publication.status !== 'active' ? (
                <button
                  className={styles.secondary}
                  disabled={working !== undefined || content.status === 'archived'}
                  type="button"
                  onClick={() => rollback(publication)}
                >
                  {working === `rollback-${publication.id}` ? '복구 중…' : 'Snapshot 복구'}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div aria-live="polite">
        {message ? <p className={styles.success}>{message}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
      </div>
    </article>
  );
}

function parseSeo(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value || '{}') as unknown;

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('SEO JSON은 Object여야 합니다.');
  }

  return parsed as Record<string, unknown>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function readError(error: unknown): string {
  if (error instanceof AtlasApiError) {
    return `${error.problem.detail}${error.requestId ? ` · 요청 ID ${error.requestId}` : ''}`;
  }

  return error instanceof Error ? error.message : '발행 요청을 처리하지 못했습니다.';
}
