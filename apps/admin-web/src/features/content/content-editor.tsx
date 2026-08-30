'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { AtlasApiError } from '../../lib/api';
import {
  archiveContent,
  createCheckpoint,
  createReadyRevision,
  loadContent,
  loadContentRevisions,
  previewContentById,
  restoreContentRevision,
  saveContentDraft,
} from './content-api';
import type { Content, ContentRevision } from './content-types';
import { ContentPublicationManager } from './content-publication-manager';
import styles from './content.module.css';

export function ContentEditor({ contentId }: Readonly<{ contentId: string }>) {
  const [content, setContent] = useState<Content>();
  const [revisions, setRevisions] = useState<readonly ContentRevision[]>([]);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [bodyMarkdown, setBodyMarkdown] = useState('');
  const [note, setNote] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewWarnings, setPreviewWarnings] = useState<readonly string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [working, setWorking] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const initialised = useRef(false);
  const saveSequence = useRef(0);

  useEffect(() => {
    void reload();
  }, [contentId]);

  useEffect(() => {
    if (!initialised.current || !dirty || !content || content.status === 'archived') {
      return;
    }

    const sequence = ++saveSequence.current;
    const timer = window.setTimeout(() => {
      void saveDraft('autosave', sequence);
    }, 1_200);

    return () => window.clearTimeout(timer);
  }, [title, summary, bodyMarkdown, dirty, content]);

  async function reload() {
    setWorking('load');
    setError(undefined);

    try {
      const [nextContent, nextRevisions] = await Promise.all([
        loadContent(contentId),
        loadContentRevisions(contentId),
      ]);
      applyContent(nextContent);
      setRevisions(nextRevisions);
      setMessage(undefined);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  function applyContent(next: Content) {
    setContent(next);
    setTitle(next.draft.title);
    setSummary(next.draft.summary ?? '');
    setBodyMarkdown(next.draft.bodyMarkdown);
    setDirty(false);
    initialised.current = true;
  }

  function markDirty(action: () => void) {
    action();
    setDirty(true);
    setMessage(undefined);
  }

  async function saveDraft(mode: 'autosave' | 'manual', sequence = ++saveSequence.current) {
    if (!content || content.status === 'archived') return;
    if (mode === 'manual') setWorking('save');
    setError(undefined);

    try {
      const next = await saveContentDraft(content.id, {
        draftVersion: content.draft.draftVersion,
        title,
        summary: summary.trim() || undefined,
        bodyMarkdown,
      });

      if (sequence === saveSequence.current || mode === 'manual') {
        setContent(next);
        setDirty(false);
        setMessage(mode === 'manual' ? 'Draft를 저장했습니다.' : '자동 저장됨');
      }
    } catch (caught) {
      const text = readError(caught);
      setError(
        caught instanceof AtlasApiError && caught.status === 409
          ? `${text} 최신 Draft를 다시 불러온 뒤 변경 내용을 확인하세요.`
          : text,
      );
    } finally {
      if (mode === 'manual') setWorking(undefined);
    }
  }

  async function preview() {
    if (!content) return;
    setWorking('preview');
    setError(undefined);

    try {
      const result = await previewContentById(content.id, {
        title,
        summary: summary.trim() || undefined,
        bodyMarkdown,
      });
      setPreviewHtml(result.html);
      setPreviewWarnings(result.warnings);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function checkpoint(kind: 'checkpoint' | 'ready') {
    if (!content) return;
    setWorking(kind);
    setError(undefined);
    setMessage(undefined);

    try {
      let current = content;
      if (dirty) {
        current = await saveContentDraft(content.id, {
          draftVersion: content.draft.draftVersion,
          title,
          summary: summary.trim() || undefined,
          bodyMarkdown,
        });
        setContent(current);
        setDirty(false);
      }

      const next =
        kind === 'ready'
          ? await createReadyRevision(current.id, {
              contentVersion: current.version,
              draftVersion: current.draft.draftVersion,
              note: note.trim() || undefined,
            })
          : await createCheckpoint(current.id, {
              contentVersion: current.version,
              draftVersion: current.draft.draftVersion,
              note: note.trim() || undefined,
            });
      setContent(next);
      setNote('');
      setRevisions(await loadContentRevisions(content.id));
      setMessage(
        kind === 'ready'
          ? `READY Revision ${next.readyRevisionNumber}을 생성했습니다.`
          : `Checkpoint Revision ${next.currentRevisionNumber}을 생성했습니다.`,
      );
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function restore(revision: ContentRevision) {
    if (!content) return;
    setWorking(`restore-${revision.id}`);
    setError(undefined);

    try {
      const next = await restoreContentRevision(
        content.id,
        revision.id,
        content.draft.draftVersion,
      );
      applyContent(next);
      setMessage(`Revision ${revision.revisionNumber}을 Draft로 복구했습니다.`);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function archive() {
    if (!content) return;
    setWorking('archive');
    setError(undefined);

    try {
      const next = await archiveContent(content.id, content.version);
      setContent(next);
      setMessage('콘텐츠를 Archive했습니다.');
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  if (!content && !error) {
    return <div className={styles.empty}>콘텐츠를 불러오는 중입니다…</div>;
  }

  if (!content) {
    return <div className={styles.empty}>{error}</div>;
  }

  const archived = content.status === 'archived';

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className="eyebrow">CONTENT · {content.type}</p>
          <h1>{title || '제목 없음'}</h1>
          <p>Draft는 계속 수정되고, Checkpoint와 READY Revision은 생성 후 변경되지 않습니다.</p>
        </div>
        <div className={styles.actions}>
          <Link className={styles.link} href="/admin/contents">
            목록으로
          </Link>
          <span className={styles.pill} data-status={content.status}>
            {content.status}
          </span>
        </div>
      </header>

      <section className={styles.panel}>
        <dl className={styles.meta}>
          <div>
            <dt>Content Version</dt>
            <dd>{content.version}</dd>
          </div>
          <div>
            <dt>Draft Version</dt>
            <dd>{content.draft.draftVersion}</dd>
          </div>
          <div>
            <dt>Latest Revision</dt>
            <dd>{content.currentRevisionNumber ?? '-'}</dd>
          </div>
          <div>
            <dt>READY Revision</dt>
            <dd>{content.readyRevisionNumber ?? '-'}</dd>
          </div>
          <div>
            <dt>저장 상태</dt>
            <dd>{dirty ? '변경 사항 있음' : (message ?? '저장됨')}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.editorGrid}>
        <div className={styles.editor}>
          <div className={styles.editorHeader}>
            <h2>Markdown Draft</h2>
            <button
              className={styles.secondary}
              disabled={working !== undefined || archived}
              type="button"
              onClick={() => saveDraft('manual')}
            >
              {working === 'save' ? '저장 중…' : '즉시 저장'}
            </button>
          </div>
          <div className={styles.formGrid}>
            <label className={`${styles.field} ${styles.full}`}>
              <span>제목</span>
              <input
                disabled={archived}
                maxLength={200}
                value={title}
                onChange={(event) => markDirty(() => setTitle(event.target.value))}
              />
            </label>
            <label className={`${styles.field} ${styles.full}`}>
              <span>요약</span>
              <textarea
                disabled={archived}
                maxLength={500}
                value={summary}
                onChange={(event) => markDirty(() => setSummary(event.target.value))}
              />
            </label>
            <label className={`${styles.field} ${styles.full}`}>
              <span>본문</span>
              <textarea
                disabled={archived}
                maxLength={500_000}
                value={bodyMarkdown}
                onChange={(event) => markDirty(() => setBodyMarkdown(event.target.value))}
              />
            </label>
          </div>
        </div>

        <div className={styles.preview}>
          <div className={styles.editorHeader}>
            <h2>Server Preview</h2>
            <button
              className={styles.secondary}
              disabled={working !== undefined}
              type="button"
              onClick={preview}
            >
              {working === 'preview' ? '렌더링 중…' : '미리보기'}
            </button>
          </div>
          {previewWarnings.map((warning) => (
            <p className={styles.warning} key={warning}>
              {warning}
            </p>
          ))}
          {previewHtml ? (
            <div className={styles.previewBody} dangerouslySetInnerHTML={{ __html: previewHtml }} />
          ) : (
            <div className={styles.empty}>서버에서 Sanitization된 Preview를 생성하세요.</div>
          )}
        </div>
      </section>

      {!archived ? (
        <section className={styles.panel}>
          <div className={styles.revisionHeader}>
            <div>
              <h2>Revision 생성</h2>
              <p>Checkpoint는 중간 기록이며 READY는 이후 발행 가능한 검증 Snapshot입니다.</p>
            </div>
          </div>
          <label className={styles.field}>
            <span>Revision Note</span>
            <input maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <div className={styles.actions}>
            <button
              className={styles.secondary}
              disabled={working !== undefined}
              type="button"
              onClick={() => checkpoint('checkpoint')}
            >
              {working === 'checkpoint' ? '생성 중…' : 'Checkpoint'}
            </button>
            <button
              className={styles.button}
              disabled={working !== undefined}
              type="button"
              onClick={() => checkpoint('ready')}
            >
              {working === 'ready' ? '검증 중…' : 'READY Revision'}
            </button>
            <button
              className={styles.danger}
              disabled={working !== undefined}
              type="button"
              onClick={archive}
            >
              {working === 'archive' ? '처리 중…' : 'Archive'}
            </button>
          </div>
        </section>
      ) : null}

      <section className={styles.panel}>
        <h2>Revision History</h2>
        <div className={styles.revisions}>
          {revisions.length === 0 ? (
            <div className={styles.empty}>아직 Revision이 없습니다.</div>
          ) : null}
          {revisions.map((revision) => (
            <article className={styles.revision} key={revision.id}>
              <span
                className={styles.pill}
                data-status={revision.kind === 'ready' ? 'ready' : 'draft'}
              >
                {revision.kind} · {revision.revisionNumber}
              </span>
              <div>
                <strong>{revision.title || '제목 없음'}</strong>
                <p className={styles.muted}>
                  {revision.note ?? `Draft v${revision.sourceDraftVersion}`} ·{' '}
                  {formatDate(revision.createdAt)}
                </p>
              </div>
              {!archived ? (
                <button
                  className={styles.secondary}
                  disabled={working !== undefined}
                  type="button"
                  onClick={() => restore(revision)}
                >
                  {working === `restore-${revision.id}` ? '복구 중…' : 'Draft로 복구'}
                </button>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <ContentPublicationManager content={content} />

      <div aria-live="polite">
        {message ? <p className={styles.success}>{message}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
        {error?.includes('다시 불러온') ? (
          <button className={styles.secondary} type="button" onClick={reload}>
            최신 Draft 다시 불러오기
          </button>
        ) : null}
      </div>
    </div>
  );
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

  return '콘텐츠 요청을 처리하지 못했습니다.';
}
