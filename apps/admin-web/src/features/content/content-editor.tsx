'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

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
import { ContentAssetPicker } from './content-asset-picker';
import { ContentCoverAssetPicker } from './content-cover-asset-picker';
import type { ContentRevision } from './content-types';
import {
  DraftOperationCancelled,
  DraftSaveCoordinator,
  type EditableDraft,
} from './draft-save-coordinator';
import { ContentPublicationManager } from './content-publication-manager';
import { isDraftValidationError } from './draft-save-error';
import styles from './content.module.css';

export function ContentEditor({ contentId }: Readonly<{ contentId: string }>) {
  // A route change creates a separate queue: old responses cannot update the next editor.
  return <ContentEditorSession key={contentId} contentId={contentId} />;
}

function ContentEditorSession({ contentId }: Readonly<{ contentId: string }>) {
  const [coordinator] = useState(
    () =>
      new DraftSaveCoordinator({
        load: () => loadContent(contentId),
        save: (input) => saveContentDraft(contentId, input),
        revision: (kind, input) =>
          kind === 'ready'
            ? createReadyRevision(contentId, input)
            : createCheckpoint(contentId, input),
        restore: (revisionId, version) => restoreContentRevision(contentId, revisionId, version),
        archive: (version) => archiveContent(contentId, version),
        isValidationError: isDraftValidationError,
      }),
  );
  const snapshot = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot,
  );
  const { content, draft, dirty, saving, locked } = snapshot;
  const { title, summary, bodyMarkdown, cover } = draft;
  const blocked = snapshot.error !== undefined;
  const [revisions, setRevisions] = useState<readonly ContentRevision[]>([]);
  const [note, setNote] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewWarnings, setPreviewWarnings] = useState<readonly string[]>([]);
  const [working, setWorking] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [requestError, setError] = useState<string>();
  const error = blocked
    ? `${readError(snapshot.error)}${
        !content
          ? ''
          : snapshot.needsReload
            ? ' 자동 저장을 중지했습니다. 현재 입력을 복사한 뒤 최신 Draft를 다시 불러오세요.'
            : ' 입력값을 수정한 뒤 다시 시도하세요. 현재 입력은 보존되어 있습니다.'
      }`
    : requestError;
  const bodyTextarea = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    coordinator.activate();
    setWorking('load');
    void Promise.all([coordinator.reload(), loadContentRevisions(contentId)])
      .then(([, nextRevisions]) => {
        if (active) setRevisions(nextRevisions);
      })
      .catch((caught) => {
        if (active && !(caught instanceof DraftOperationCancelled)) setError(readError(caught));
      })
      .finally(() => {
        if (active) setWorking(undefined);
      });
    return () => {
      active = false;
      mounted.current = false;
      coordinator.deactivate();
    };
  }, [contentId, coordinator]);

  useEffect(() => {
    if (!dirty || saving || locked || blocked || !content || content.status === 'archived') {
      return;
    }
    const timer = window.setTimeout(() => {
      void saveDraft('autosave');
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, saving, locked, blocked, content, coordinator]);

  useEffect(() => {
    if (!dirty && !saving) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, saving]);

  async function reload() {
    if (dirty && !window.confirm('현재 입력을 버리고 서버의 최신 Draft를 불러오시겠습니까?'))
      return;
    setWorking('load');
    setError(undefined);
    try {
      const [, nextRevisions] = await Promise.all([
        coordinator.reload(),
        loadContentRevisions(contentId),
      ]);
      if (!mounted.current) return;
      setRevisions(nextRevisions);
      setPreviewHtml('');
      setPreviewWarnings([]);
      setMessage(undefined);
    } catch (caught) {
      if (mounted.current && !(caught instanceof DraftOperationCancelled)) {
        setError(readError(caught));
      }
    } finally {
      if (mounted.current) setWorking(undefined);
    }
  }

  function edit(patch: Partial<EditableDraft>) {
    if (coordinator.edit(patch)) {
      setMessage(undefined);
      setError(undefined);
    }
  }

  function insertAssetMarkdown(markdown: string) {
    const textarea = bodyTextarea.current;
    const start = textarea?.selectionStart ?? bodyMarkdown.length;
    const end = textarea?.selectionEnd ?? start;
    const before = bodyMarkdown.slice(0, start);
    const after = bodyMarkdown.slice(end);
    const prefix = blockSeparatorBefore(before);
    const suffix = blockSeparatorAfter(after);
    const insertion = `${prefix}${markdown}${suffix}`;
    const next = `${before}${insertion}${after}`;
    const cursor = start + prefix.length + markdown.length;

    edit({ bodyMarkdown: next });
    setMessage('Asset Reference를 Markdown에 삽입했습니다.');
    window.requestAnimationFrame(() => {
      bodyTextarea.current?.focus();
      bodyTextarea.current?.setSelectionRange(cursor, cursor);
    });
  }

  async function saveDraft(mode: 'autosave' | 'manual') {
    if (mode === 'manual') setWorking('save');
    setError(undefined);
    try {
      await coordinator.save();
      if (mounted.current && !coordinator.getSnapshot().dirty) {
        setMessage(mode === 'manual' ? 'Draft를 저장했습니다.' : '자동 저장됨');
      }
    } catch (caught) {
      if (mounted.current && !(caught instanceof DraftOperationCancelled)) {
        setError(readError(caught));
      }
    } finally {
      if (mounted.current && mode === 'manual') setWorking(undefined);
    }
  }

  async function preview() {
    if (!content) return;
    setWorking('preview');
    setError(undefined);

    try {
      const previewDraft = coordinator.getSnapshot().draft;
      const result = await previewContentById(content.id, {
        title,
        summary: summary.trim() || undefined,
        bodyMarkdown,
        cover,
      });
      if (!mounted.current || coordinator.getSnapshot().draft !== previewDraft) return;
      setPreviewHtml(result.html);
      setPreviewWarnings(result.warnings);
    } catch (caught) {
      if (mounted.current && !(caught instanceof DraftOperationCancelled)) {
        setError(readError(caught));
      }
    } finally {
      if (mounted.current) setWorking(undefined);
    }
  }

  async function checkpoint(kind: 'checkpoint' | 'ready') {
    if (!content) return;
    setWorking(kind);
    setError(undefined);
    setMessage(undefined);

    try {
      const next = await coordinator.createRevision(kind, note);
      if (!mounted.current) return;
      setNote('');
      const nextRevisions = await loadContentRevisions(content.id);
      if (!mounted.current) return;
      setRevisions(nextRevisions);
      setMessage(
        kind === 'ready'
          ? `READY Revision ${next.readyRevisionNumber}을 생성했습니다.`
          : `Checkpoint Revision ${next.currentRevisionNumber}을 생성했습니다.`,
      );
    } catch (caught) {
      if (mounted.current && !(caught instanceof DraftOperationCancelled)) {
        setError(readError(caught));
      }
    } finally {
      if (mounted.current) setWorking(undefined);
    }
  }

  async function restore(revision: ContentRevision) {
    if (!content) return;
    if (dirty && !window.confirm('현재 입력을 버리고 선택한 Revision으로 복구하시겠습니까?'))
      return;
    setWorking(`restore-${revision.id}`);
    setError(undefined);

    try {
      await coordinator.restore(revision.id);
      if (!mounted.current) return;
      setPreviewHtml('');
      setPreviewWarnings([]);
      setMessage(`Revision ${revision.revisionNumber}을 Draft로 복구했습니다.`);
    } catch (caught) {
      if (mounted.current && !(caught instanceof DraftOperationCancelled)) {
        setError(readError(caught));
      }
    } finally {
      if (mounted.current) setWorking(undefined);
    }
  }

  async function archive() {
    if (!content) return;
    setWorking('archive');
    setError(undefined);

    try {
      await coordinator.archive();
      if (!mounted.current) return;
      setMessage('콘텐츠를 Archive했습니다.');
    } catch (caught) {
      if (mounted.current && !(caught instanceof DraftOperationCancelled)) {
        setError(readError(caught));
      }
    } finally {
      if (mounted.current) setWorking(undefined);
    }
  }

  if (!content && !error) {
    return <div className={styles.empty}>콘텐츠를 불러오는 중입니다…</div>;
  }

  if (!content) {
    return (
      <div className={styles.empty}>
        {error}
        <button type="button" disabled={locked} onClick={reload}>
          다시 불러오기
        </button>
      </div>
    );
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
            <dd data-testid="content-draft-version">{content.draft.draftVersion}</dd>
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
            <dd>{saving ? '저장 중…' : dirty ? '변경 사항 있음' : (message ?? '저장됨')}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.editorGrid}>
        <div className={styles.editor}>
          <div className={styles.editorHeader}>
            <h2>Markdown Draft</h2>
            <button
              className={styles.secondary}
              disabled={working !== undefined || archived || locked || blocked}
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
                disabled={archived || locked || working === 'load'}
                maxLength={200}
                value={title}
                onChange={(event) => edit({ title: event.target.value })}
              />
            </label>
            <label className={`${styles.field} ${styles.full}`}>
              <span>요약</span>
              <textarea
                disabled={archived || locked || working === 'load'}
                maxLength={500}
                value={summary}
                onChange={(event) => edit({ summary: event.target.value })}
              />
            </label>

            <div className={`${styles.field} ${styles.full}`}>
              <div className={styles.fieldHeading}>
                <span>Cover Image</span>
                <ContentCoverAssetPicker
                  disabled={working !== undefined || archived || locked || blocked}
                  value={cover}
                  onChange={(nextCover) => edit({ cover: nextCover })}
                />
              </div>
              <p className={styles.muted}>
                Cover는 READY Revision과 Publication Asset Manifest에 불변 Snapshot으로 포함됩니다.
              </p>
            </div>
            <div className={`${styles.field} ${styles.full}`}>
              <div className={styles.fieldHeading}>
                <label htmlFor="content-body-markdown">본문</label>
                <ContentAssetPicker
                  disabled={working !== undefined || archived || locked || blocked}
                  onInsert={insertAssetMarkdown}
                />
              </div>
              <textarea
                ref={bodyTextarea}
                disabled={archived || locked || working === 'load'}
                id="content-body-markdown"
                maxLength={500_000}
                value={bodyMarkdown}
                onChange={(event) => edit({ bodyMarkdown: event.target.value })}
              />
            </div>
          </div>
        </div>

        <div className={styles.preview}>
          <div className={styles.editorHeader}>
            <h2>Server Preview</h2>
            <button
              className={styles.secondary}
              disabled={working !== undefined || locked || blocked}
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
            <input
              disabled={locked || working !== undefined}
              maxLength={300}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className={styles.actions}>
            <button
              className={styles.secondary}
              disabled={working !== undefined || locked || blocked}
              type="button"
              onClick={() => checkpoint('checkpoint')}
            >
              {working === 'checkpoint' ? '생성 중…' : 'Checkpoint'}
            </button>
            <button
              className={styles.button}
              disabled={working !== undefined || locked || blocked}
              type="button"
              onClick={() => checkpoint('ready')}
            >
              {working === 'ready' ? '검증 중…' : 'READY Revision'}
            </button>
            <button
              className={styles.danger}
              disabled={working !== undefined || locked || blocked}
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
                  disabled={working !== undefined || locked || blocked}
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
        {blocked ? (
          <div>
            <details>
              <summary>현재 입력 확인·복사</summary>
              <textarea
                aria-label="보존된 Draft 입력"
                readOnly
                value={JSON.stringify(draft, null, 2)}
                onFocus={(event) => event.currentTarget.select()}
              />
            </details>
            <button
              className={styles.secondary}
              disabled={locked || saving}
              type="button"
              onClick={reload}
            >
              현재 입력 버리고 최신 Draft 불러오기
            </button>
          </div>
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

function blockSeparatorBefore(value: string): string {
  if (value.length === 0 || value.endsWith('\n\n')) return '';
  return value.endsWith('\n') ? '\n' : '\n\n';
}

function blockSeparatorAfter(value: string): string {
  if (value.length === 0 || value.startsWith('\n\n')) return '';
  return value.startsWith('\n') ? '\n' : '\n\n';
}
