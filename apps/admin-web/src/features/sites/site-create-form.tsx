'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { AtlasApiError } from '../../lib/api';
import { createSite, loadWorkspace } from './site-api';
import { SITE_TYPE_OPTIONS, type SiteType } from './site-types';
import styles from './sites.module.css';

export function SiteCreateForm() {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<SiteType>('blog');
  const [timezone, setTimezone] = useState('Asia/Seoul');
  const [locale, setLocale] = useState('ko-KR');
  const [canonicalDomain, setCanonicalDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    loadWorkspace()
      .then((workspace) => {
        setTimezone(workspace.timezone);
        setLocale(workspace.locale);
      })
      .catch(() => undefined);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);

    try {
      const site = await createSite({
        key,
        name,
        description,
        type,
        timezone,
        locale,
        canonicalDomain,
      });
      router.replace(`/admin/sites/${site.id}`);
      router.refresh();
    } catch (caught) {
      setError(readError(caught));
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className="eyebrow">NEW SITE</p>
          <h1>Site 등록</h1>
          <p>Key는 이후 Delivery API와 내부 Scope에서 사용하는 안정 식별자입니다.</p>
        </div>
        <Link className={styles.secondaryLink} href="/admin/sites">
          목록으로
        </Link>
      </header>

      <section className={styles.panel}>
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>Site Key</span>
              <input
                autoFocus
                required
                minLength={2}
                maxLength={64}
                placeholder="main-blog"
                value={key}
                onChange={(event) => setKey(event.target.value.toLowerCase())}
              />
            </label>
            <label className={styles.field}>
              <span>이름</span>
              <input
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>유형</span>
              <select value={type} onChange={(event) => setType(event.target.value as SiteType)}>
                {SITE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Canonical Domain</span>
              <input
                maxLength={253}
                placeholder="blog.example.com"
                value={canonicalDomain}
                onChange={(event) => setCanonicalDomain(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>Timezone</span>
              <input
                required
                maxLength={64}
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>Locale</span>
              <input
                required
                maxLength={32}
                value={locale}
                onChange={(event) => setLocale(event.target.value)}
              />
            </label>
            <label className={`${styles.field} ${styles.fullWidth}`}>
              <span>설명</span>
              <textarea
                maxLength={500}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
          </div>
          <div className={styles.feedback} aria-live="polite">
            {error ? <p className={styles.error}>{error}</p> : null}
          </div>
          <button className={styles.button} disabled={busy} type="submit">
            {busy ? '등록 중…' : 'Draft Site 등록'}
          </button>
        </form>
      </section>
    </div>
  );
}

function readError(error: unknown): string {
  if (error instanceof AtlasApiError) {
    return `${error.problem.detail}${error.requestId ? ` · 요청 ID ${error.requestId}` : ''}`;
  }

  return 'Site를 등록하지 못했습니다.';
}
