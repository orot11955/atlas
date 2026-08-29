'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { AtlasApiError } from '../../lib/api';
import { changeSiteStatus, loadSite, updateSite } from './site-api';
import {
  SITE_TYPE_OPTIONS,
  getSiteStatusTransitions,
  siteStatusLabel,
  type Site,
  type SiteStatus,
  type SiteType,
} from './site-types';
import styles from './sites.module.css';

export function SiteDetail({ siteId }: Readonly<{ siteId: string }>) {
  const [site, setSite] = useState<Site>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<SiteType>('blog');
  const [timezone, setTimezone] = useState('Asia/Seoul');
  const [locale, setLocale] = useState('ko-KR');
  const [canonicalDomain, setCanonicalDomain] = useState('');
  const [working, setWorking] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    loadSite(siteId)
      .then(applySite)
      .catch((caught) => setError(readError(caught)));
  }, [siteId]);

  function applySite(next: Site) {
    setSite(next);
    setName(next.name);
    setDescription(next.description ?? '');
    setType(next.type);
    setTimezone(next.timezone);
    setLocale(next.locale);
    setCanonicalDomain(next.canonicalDomain?.hostname ?? '');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!site) {
      return;
    }

    setWorking('save');
    setMessage(undefined);
    setError(undefined);

    try {
      const updated = await updateSite(site.id, {
        version: site.version,
        name,
        description,
        type,
        timezone,
        locale,
        canonicalDomain,
      });
      applySite(updated);
      setMessage('Site 설정을 저장했습니다.');
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function transition(status: SiteStatus) {
    if (!site) {
      return;
    }

    setWorking(status);
    setMessage(undefined);
    setError(undefined);

    try {
      const updated = await changeSiteStatus(site.id, status, site.version);
      applySite(updated);
      setMessage(`Site 상태를 ${siteStatusLabel(status)}로 변경했습니다.`);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  if (!site && !error) {
    return <div className={styles.empty}>Site를 불러오는 중입니다…</div>;
  }

  if (!site) {
    return <div className={styles.empty}>{error}</div>;
  }

  const archived = site.status === 'archived';

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className="eyebrow">SITE · {site.key}</p>
          <h1>{site.name}</h1>
          <p>Workspace Scope 안에서 Site 설정과 운영 상태를 관리합니다.</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.secondaryLink} href="/admin/sites">
            목록으로
          </Link>
          <span className={styles.statusPill} data-status={site.status}>
            {siteStatusLabel(site.status)}
          </span>
        </div>
      </header>

      <section className={styles.panel}>
        <dl className={styles.metaGrid}>
          <div>
            <dt>Site ID</dt>
            <dd>{site.id}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{site.version}</dd>
          </div>
          <div>
            <dt>Canonical Domain</dt>
            <dd>{site.canonicalDomain?.hostname ?? '미설정'}</dd>
          </div>
          <div>
            <dt>Verification</dt>
            <dd>{site.canonicalDomain?.verificationStatus ?? 'not-configured'}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.panel}>
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>이름</span>
              <input disabled={archived} required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span>유형</span>
              <select disabled={archived} value={type} onChange={(event) => setType(event.target.value as SiteType)}>
                {SITE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Canonical Domain</span>
              <input disabled={archived} maxLength={253} value={canonicalDomain} onChange={(event) => setCanonicalDomain(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span>Timezone</span>
              <input disabled={archived} required maxLength={64} value={timezone} onChange={(event) => setTimezone(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span>Locale</span>
              <input disabled={archived} required maxLength={32} value={locale} onChange={(event) => setLocale(event.target.value)} />
            </label>
            <label className={`${styles.field} ${styles.fullWidth}`}>
              <span>설명</span>
              <textarea disabled={archived} maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
          </div>
          {!archived ? (
            <button className={styles.button} disabled={working !== undefined} type="submit">
              {working === 'save' ? '저장 중…' : 'Site 설정 저장'}
            </button>
          ) : null}
        </form>
      </section>

      <section className={styles.panel}>
        <div className={styles.cardHeader}>
          <div>
            <h2>운영 상태</h2>
            <p>상태 전이는 서버 Domain Policy가 허용하는 경로만 제공합니다.</p>
          </div>
        </div>
        <div className={styles.statusActions}>
          {getSiteStatusTransitions(site.status).map((target) => (
            <button
              className={target === 'archived' ? styles.dangerButton : styles.secondaryLink}
              disabled={working !== undefined}
              key={target}
              type="button"
              onClick={() => transition(target)}
            >
              {working === target ? '변경 중…' : siteStatusLabel(target)}
            </button>
          ))}
        </div>
      </section>

      <div className={styles.feedback} aria-live="polite">
        {message ? <p className={styles.message}>{message}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
      </div>
    </div>
  );
}

function readError(error: unknown): string {
  if (error instanceof AtlasApiError) {
    return `${error.problem.detail}${error.requestId ? ` · 요청 ID ${error.requestId}` : ''}`;
  }

  return 'Site 요청을 처리하지 못했습니다.';
}
