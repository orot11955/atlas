'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { AtlasApiError } from '../../lib/api';
import { loadSites } from '../sites/site-api';
import type { Site } from '../sites/site-types';
import {
  changeApiClientStatus,
  loadApiClient,
  parseAllowedOrigins,
  revokeApiClientKey,
  rotateApiClientKey,
  toOptionalIsoDate,
  updateApiClient,
} from './api-client-api';
import { CredentialPanel, ScopeSelector, SiteAccessSelector } from './api-client-shared';
import {
  apiClientKeyStatusLabel,
  apiClientStatusLabel,
  apiClientTypeLabel,
  getApiClientStatusTransitions,
  type ApiClient,
  type ApiClientCredential,
  type ApiClientScope,
  type ApiClientStatus,
} from './api-client-types';
import styles from './api-clients.module.css';

export function ApiClientDetail({ apiClientId }: Readonly<{ apiClientId: string }>) {
  const [client, setClient] = useState<ApiClient>();
  const [sites, setSites] = useState<readonly Site[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rateLimit, setRateLimit] = useState(600);
  const [requireOrigin, setRequireOrigin] = useState(false);
  const [siteIds, setSiteIds] = useState<readonly string[]>([]);
  const [scopes, setScopes] = useState<readonly ApiClientScope[]>([]);
  const [origins, setOrigins] = useState('');
  const [graceSeconds, setGraceSeconds] = useState(3600);
  const [expiresAt, setExpiresAt] = useState('');
  const [credential, setCredential] = useState<ApiClientCredential>();
  const [working, setWorking] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    Promise.all([loadApiClient(apiClientId), loadSites({ limit: 100 })])
      .then(([nextClient, siteResult]) => {
        applyClient(nextClient);
        setSites(siteResult.items);
      })
      .catch((caught) => setError(readError(caught)));
  }, [apiClientId]);

  function applyClient(next: ApiClient) {
    setClient(next);
    setName(next.name);
    setDescription(next.description ?? '');
    setRateLimit(next.rateLimitPerMinute);
    setRequireOrigin(next.requireOrigin);
    setSiteIds(next.siteIds);
    setScopes(next.scopes);
    setOrigins(next.allowedOrigins.join('\n'));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!client) {
      return;
    }

    await run('save', async () => {
      const updated = await updateApiClient(client.id, {
        version: client.version,
        name,
        description,
        rateLimitPerMinute: rateLimit,
        requireOrigin,
        siteIds,
        scopes,
        allowedOrigins: parseAllowedOrigins(origins),
      });
      applyClient(updated);
      setMessage('API Client 설정을 저장했습니다.');
    });
  }

  async function rotate() {
    if (!client) {
      return;
    }

    await run('rotate', async () => {
      const result = await rotateApiClientKey(client.id, {
        gracePeriodSeconds: graceSeconds,
        expiresAt: toOptionalIsoDate(expiresAt),
      });
      applyClient(result.client);
      setCredential(result.credential);
      setMessage('새 API Key를 발급했습니다.');
    });
  }

  async function revoke(keyId: string) {
    if (!client) {
      return;
    }

    await run(keyId, async () => {
      applyClient(await revokeApiClientKey(client.id, keyId));
      setMessage('API Key를 폐기했습니다.');
    });
  }

  async function changeStatus(status: ApiClientStatus) {
    if (!client) {
      return;
    }

    await run(status, async () => {
      applyClient(await changeApiClientStatus(client.id, status, client.version));
      setMessage(`API Client 상태를 ${apiClientStatusLabel(status)}로 변경했습니다.`);
    });
  }

  async function run(key: string, task: () => Promise<void>) {
    setWorking(key);
    setMessage(undefined);
    setError(undefined);

    try {
      await task();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  if (!client && !error) {
    return <div className={styles.empty}>API Client를 불러오는 중입니다…</div>;
  }

  if (!client) {
    return <div className={styles.empty}>{error}</div>;
  }

  const archived = client.status === 'archived';

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className="eyebrow">API CLIENT · {apiClientTypeLabel(client.type)}</p>
          <h1>{client.name}</h1>
          <p>Site Scope와 Key 수명주기, Origin 정책과 Rate Limit을 관리합니다.</p>
        </div>
        <div className={styles.actions}>
          <Link className={styles.secondaryLink} href="/admin/api-clients">
            목록으로
          </Link>
          <span className={styles.statusPill} data-status={client.status}>
            {apiClientStatusLabel(client.status)}
          </span>
        </div>
      </header>

      {credential ? (
        <CredentialPanel credential={credential} onDismiss={() => setCredential(undefined)} />
      ) : null}

      <section className={styles.panel}>
        <form className={styles.form} onSubmit={save}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>이름</span>
              <input
                disabled={archived}
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>유형</span>
              <input disabled value={apiClientTypeLabel(client.type)} />
            </label>
            <label className={styles.field}>
              <span>분당 요청 제한</span>
              <input
                disabled={archived}
                min={1}
                max={100000}
                type="number"
                value={rateLimit}
                onChange={(event) => setRateLimit(Number(event.target.value))}
              />
            </label>
            <label className={`${styles.field} ${styles.fullWidth}`}>
              <span>설명</span>
              <textarea
                disabled={archived}
                maxLength={500}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
          </div>
          <SiteAccessSelector
            disabled={archived}
            sites={sites}
            value={siteIds}
            onChange={setSiteIds}
          />
          <ScopeSelector
            disabled={archived}
            type={client.type}
            value={scopes}
            onChange={setScopes}
          />
          <label className={styles.field}>
            <span>Allowed Origin · 한 줄에 하나</span>
            <textarea
              disabled={archived}
              value={origins}
              onChange={(event) => setOrigins(event.target.value)}
            />
          </label>
          <label className={styles.toggleField}>
            <input
              disabled={archived}
              checked={requireOrigin}
              type="checkbox"
              onChange={(event) => setRequireOrigin(event.target.checked)}
            />
            <span>Origin Header를 필수로 요구</span>
          </label>
          {!archived ? (
            <button
              className={styles.primaryButton}
              disabled={working !== undefined || siteIds.length === 0 || scopes.length === 0}
              type="submit"
            >
              {working === 'save' ? '저장 중…' : '설정 저장'}
            </button>
          ) : null}
        </form>
      </section>

      {!archived ? (
        <section className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Key 회전</h2>
              <p>새 Key 원문은 한 번만 표시되고, 기존 Key는 지정한 유예 기간 동안 유지됩니다.</p>
            </div>
          </div>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>기존 Key 유예 시간 · 초</span>
              <input
                min={0}
                max={604800}
                type="number"
                value={graceSeconds}
                onChange={(event) => setGraceSeconds(Number(event.target.value))}
              />
            </label>
            <label className={styles.field}>
              <span>새 Key 만료 시각</span>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </label>
          </div>
          <button
            className={styles.primaryButton}
            disabled={working !== undefined}
            type="button"
            onClick={rotate}
          >
            {working === 'rotate' ? '회전 중…' : '새 Key 발급'}
          </button>
        </section>
      ) : null}

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>발급된 Key</h2>
            <p>원문은 표시하지 않으며 Prefix와 사용·만료 상태만 제공합니다.</p>
          </div>
        </div>
        <div className={styles.keyList}>
          {client.keys.map((key) => (
            <article className={styles.keyItem} key={key.id}>
              <div>
                <div className={styles.cardHeader}>
                  <code>{key.keyPrefix}</code>
                  <span className={styles.keyStatus} data-status={key.status}>
                    {apiClientKeyStatusLabel(key.status)}
                  </span>
                </div>
                <p className={styles.muted}>
                  생성 {formatDate(key.createdAt)} · 최근 사용{' '}
                  {key.lastUsedAt ? formatDate(key.lastUsedAt) : '없음'}
                </p>
                {key.expiresAt ? <small>만료 {formatDate(key.expiresAt)}</small> : null}
                {key.graceExpiresAt ? (
                  <small>유예 종료 {formatDate(key.graceExpiresAt)}</small>
                ) : null}
              </div>
              {(key.status === 'active' || key.status === 'grace') && !archived ? (
                <button
                  className={styles.dangerButton}
                  disabled={working !== undefined}
                  type="button"
                  onClick={() => revoke(key.id)}
                >
                  {working === key.id ? '폐기 중…' : '폐기'}
                </button>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>운영 상태</h2>
            <p>Disabled는 Key를 보존하지만 인증을 차단하고, Archived는 모든 Key를 폐기합니다.</p>
          </div>
        </div>
        <div className={styles.actions}>
          {getApiClientStatusTransitions(client.status).map((status) => (
            <button
              className={status === 'archived' ? styles.dangerButton : styles.secondaryButton}
              disabled={working !== undefined}
              key={status}
              type="button"
              onClick={() => changeStatus(status)}
            >
              {working === status ? '변경 중…' : apiClientStatusLabel(status)}
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

  return 'API Client 요청을 처리하지 못했습니다.';
}
