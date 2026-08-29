'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { AtlasApiError } from '../../lib/api';
import { loadSites, loadWorkspace, updateWorkspace } from './site-api';
import {
  SITE_STATUS_OPTIONS,
  SITE_TYPE_OPTIONS,
  siteStatusLabel,
  siteTypeLabel,
  type Site,
  type SiteStatus,
  type SiteType,
  type Workspace,
} from './site-types';
import styles from './sites.module.css';

export function SiteList() {
  const [workspace, setWorkspace] = useState<Workspace>();
  const [sites, setSites] = useState<readonly Site[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<SiteStatus | ''>('');
  const [type, setType] = useState<SiteType | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void loadInitial();
  }, []);

  async function loadInitial() {
    setLoading(true);
    setError(undefined);

    try {
      const [nextWorkspace, result] = await Promise.all([
        loadWorkspace(),
        loadSites({ limit: 24 }),
      ]);
      setWorkspace(nextWorkspace);
      setSites(result.items);
      setNextCursor(result.pageInfo.nextCursor);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setLoading(false);
    }
  }

  async function handleFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(undefined);

    try {
      const result = await loadSites({
        limit: 24,
        search,
        status: status || undefined,
        type: type || undefined,
      });
      setSites(result.items);
      setNextCursor(result.pageInfo.nextCursor);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor) {
      return;
    }

    setLoading(true);
    setError(undefined);

    try {
      const result = await loadSites({
        limit: 24,
        cursor: nextCursor,
        search,
        status: status || undefined,
        type: type || undefined,
      });
      setSites((current) => [...current, ...result.items]);
      setNextCursor(result.pageInfo.nextCursor);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className="eyebrow">WORKSPACE · SITE</p>
          <h1>Site 관리</h1>
          <p>하나의 Workspace에서 Blog, Portfolio, Docs와 Photo Site를 분리해 운영합니다.</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.primaryLink} href="/admin/sites/new">
            Site 등록
          </Link>
        </div>
      </header>

      {workspace ? (
        <WorkspaceSettings workspace={workspace} onUpdated={setWorkspace} />
      ) : null}

      <section className={styles.panel}>
        <form className={styles.toolbar} onSubmit={handleFilter}>
          <label className={styles.field}>
            <span>검색</span>
            <input
              placeholder="이름 또는 Key"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>상태</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as SiteStatus | '')}
            >
              <option value="">전체</option>
              {SITE_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>유형</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value as SiteType | '')}
            >
              <option value="">전체</option>
              {SITE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button className={styles.button} disabled={loading} type="submit">
            조회
          </button>
        </form>
      </section>

      {error ? <p className={styles.error}>{error}</p> : null}

      {!loading && sites.length === 0 ? (
        <div className={styles.empty}>조건에 맞는 Site가 없습니다.</div>
      ) : (
        <section className={styles.siteGrid} aria-label="Site 목록">
          {sites.map((site) => (
            <article className={styles.card} key={site.id}>
              <div>
                <div className={styles.cardHeader}>
                  <span className={styles.typePill}>{siteTypeLabel(site.type)}</span>
                  <span className={styles.statusPill} data-status={site.status}>
                    {siteStatusLabel(site.status)}
                  </span>
                </div>
                <p className={styles.siteKey}>{site.key}</p>
                <h2>{site.name}</h2>
                <p>{site.description ?? '설명이 아직 등록되지 않았습니다.'}</p>
              </div>
              <div>
                <p className={styles.domainState}>
                  {site.canonicalDomain
                    ? `${site.canonicalDomain.hostname} · ${site.canonicalDomain.verificationStatus}`
                    : 'Canonical Domain 미설정'}
                </p>
                <Link className={styles.secondaryLink} href={`/admin/sites/${site.id}`}>
                  상세 관리
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}

      {nextCursor ? (
        <button className={styles.secondaryLink} disabled={loading} type="button" onClick={loadMore}>
          더 불러오기
        </button>
      ) : null}
    </div>
  );
}

function WorkspaceSettings({
  workspace,
  onUpdated,
}: Readonly<{
  workspace: Workspace;
  onUpdated: (workspace: Workspace) => void;
}>) {
  const [name, setName] = useState(workspace.name);
  const [timezone, setTimezone] = useState(workspace.timezone);
  const [locale, setLocale] = useState(workspace.locale);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    setError(undefined);

    try {
      const updated = await updateWorkspace({
        version: workspace.version,
        name,
        timezone,
        locale,
      });
      onUpdated(updated);
      setMessage('Workspace 설정을 저장했습니다.');
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.workspaceGrid}>
        <div>
          <p className="eyebrow">DEFAULT WORKSPACE</p>
          <h2>{workspace.name}</h2>
          <p>
            Key <code>{workspace.key}</code> · Version {workspace.version}
          </p>
        </div>
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>이름</span>
              <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span>Timezone</span>
              <input required maxLength={64} value={timezone} onChange={(event) => setTimezone(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span>Locale</span>
              <input required maxLength={32} value={locale} onChange={(event) => setLocale(event.target.value)} />
            </label>
            <button className={styles.button} disabled={busy} type="submit">
              {busy ? '저장 중…' : 'Workspace 저장'}
            </button>
          </div>
          <div className={styles.feedback} aria-live="polite">
            {message ? <span className={styles.message}>{message}</span> : null}
            {error ? <span className={styles.error}>{error}</span> : null}
          </div>
        </form>
      </div>
    </section>
  );
}

function readError(error: unknown): string {
  if (error instanceof AtlasApiError) {
    return `${error.problem.detail}${error.requestId ? ` · 요청 ID ${error.requestId}` : ''}`;
  }

  return 'Site 정보를 처리하지 못했습니다.';
}
