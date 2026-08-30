'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { AtlasApiError } from '../../lib/api';
import { createContent, loadContents } from './content-api';
import {
  CONTENT_STATUS_OPTIONS,
  CONTENT_TYPE_OPTIONS,
  type Content,
  type ContentStatus,
  type ContentType,
} from './content-types';
import styles from './content.module.css';

export function ContentList() {
  const router = useRouter();
  const [items, setItems] = useState<readonly Content[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ContentStatus | ''>('');
  const [type, setType] = useState<ContentType | ''>('');
  const [newType, setNewType] = useState<ContentType>('post');
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setBusy(true);
    setError(undefined);

    try {
      const result = await loadContents({
        limit: 24,
        search,
        status: status || undefined,
        type: type || undefined,
      });
      setItems(result.items);
      setNextCursor(result.pageInfo.nextCursor);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await refresh();
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);

    try {
      const content = await createContent({
        type: newType,
        title: newTitle,
      });
      router.push(`/admin/contents/${content.id}`);
    } catch (caught) {
      setError(readError(caught));
      setBusy(false);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setBusy(true);

    try {
      const result = await loadContents({
        limit: 24,
        cursor: nextCursor,
        search,
        status: status || undefined,
        type: type || undefined,
      });
      setItems((current) => [...current, ...result.items]);
      setNextCursor(result.pageInfo.nextCursor);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className="eyebrow">CONTENT CORE</p>
          <h1>콘텐츠</h1>
          <p>편집 Draft와 불변 Revision을 분리해 글의 작업본과 검증본을 안전하게 관리합니다.</p>
        </div>
      </header>

      <section className={styles.panel}>
        <h2>새 콘텐츠</h2>
        <form className={styles.toolbar} onSubmit={create}>
          <label className={styles.field}>
            <span>유형</span>
            <select value={newType} onChange={(event) => setNewType(event.target.value as ContentType)}>
              {CONTENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>초기 제목</span>
            <input maxLength={200} placeholder="제목은 나중에 입력해도 됩니다" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} />
          </label>
          <button className={styles.button} disabled={busy} type="submit">Draft 생성</button>
        </form>
      </section>

      <section className={styles.panel}>
        <form className={styles.toolbar} onSubmit={submitFilter}>
          <label className={styles.field}>
            <span>검색</span>
            <input maxLength={120} value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>상태</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as ContentStatus | '')}>
              <option value="">전체</option>
              {CONTENT_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>유형</span>
            <select value={type} onChange={(event) => setType(event.target.value as ContentType | '')}>
              <option value="">전체</option>
              {CONTENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <button className={styles.secondary} disabled={busy} type="submit">조회</button>
        </form>
      </section>

      {error ? <p className={styles.error}>{error}</p> : null}

      {!busy && items.length === 0 ? (
        <div className={styles.empty}>조건에 맞는 콘텐츠가 없습니다.</div>
      ) : (
        <section className={styles.grid} aria-label="콘텐츠 목록">
          {items.map((content) => (
            <article className={styles.card} key={content.id}>
              <div>
                <div className={styles.header}>
                  <span className={styles.pill}>{content.type}</span>
                  <span className={styles.pill} data-status={content.status}>{content.status}</span>
                </div>
                <h2>{content.draft.title || '제목 없음'}</h2>
                <p>{content.draft.summary ?? '요약이 없습니다.'}</p>
              </div>
              <div>
                <p className={styles.muted}>
                  Draft v{content.draft.draftVersion} · Latest {content.currentRevisionNumber ?? '-'} · Ready {content.readyRevisionNumber ?? '-'}
                </p>
                <Link className={styles.link} href={`/admin/contents/${content.id}`}>편집</Link>
              </div>
            </article>
          ))}
        </section>
      )}

      {nextCursor ? (
        <button className={styles.secondary} disabled={busy} type="button" onClick={loadMore}>더 불러오기</button>
      ) : null}
    </div>
  );
}

function readError(error: unknown): string {
  if (error instanceof AtlasApiError) {
    return `${error.problem.detail}${error.requestId ? ` · 요청 ID ${error.requestId}` : ''}`;
  }

  return '콘텐츠 요청을 처리하지 못했습니다.';
}
