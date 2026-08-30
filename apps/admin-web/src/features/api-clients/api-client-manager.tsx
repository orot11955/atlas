'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { AtlasApiError } from '../../lib/api';
import { loadSites } from '../sites/site-api';
import type { Site } from '../sites/site-types';
import {
  buildApiClientListPath,
  createApiClient,
  loadApiClients,
  parseAllowedOrigins,
  toOptionalIsoDate,
} from './api-client-api';
import { CredentialPanel, ScopeSelector, SiteAccessSelector } from './api-client-shared';
import {
  API_CLIENT_STATUS_OPTIONS,
  API_CLIENT_TYPE_OPTIONS,
  apiClientStatusLabel,
  apiClientTypeLabel,
  getApiClientScopes,
  type ApiClient,
  type ApiClientCredential,
  type ApiClientScope,
  type ApiClientStatus,
  type ApiClientType,
} from './api-client-types';
import styles from './api-clients.module.css';

export function ApiClientManager() {
  const [sites, setSites] = useState<readonly Site[]>([]);
  const [clients, setClients] = useState<readonly ApiClient[]>([]);
  const [credential, setCredential] = useState<ApiClientCredential>();
  const [search, setSearch] = useState('');
  const [filterSiteId, setFilterSiteId] = useState('');
  const [filterStatus, setFilterStatus] = useState<ApiClientStatus | ''>('');
  const [filterType, setFilterType] = useState<ApiClientType | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void loadInitial();
  }, []);

  async function loadInitial() {
    setLoading(true);
    setError(undefined);

    try {
      const [siteResult, clientResult] = await Promise.all([
        loadSites({ limit: 100 }),
        loadApiClients(),
      ]);
      setSites(siteResult.items.filter((site) => site.status !== 'archived'));
      setClients(clientResult);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setLoading(false);
    }
  }

  async function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(undefined);

    try {
      setClients(
        await loadApiClients({
          siteId: filterSiteId || undefined,
          status: filterStatus || undefined,
          type: filterType || undefined,
          search,
        }),
      );
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
          <p className="eyebrow">SITE-SCOPED CREDENTIALS</p>
          <h1>API Client</h1>
          <p>
            Blog Delivery와 CI Integration이 사용하는 최소 권한 Credential을 Site별로
            분리합니다.
          </p>
        </div>
      </header>

      {credential ? (
        <CredentialPanel
          credential={credential}
          onDismiss={() => setCredential(undefined)}
        />
      ) : null}

      <ApiClientCreateForm
        sites={sites}
        onCreated={(client, nextCredential) => {
          setClients((current) => [client, ...current]);
          setCredential(nextCredential);
        }}
      />

      <section className={styles.panel}>
        <form className={styles.filterBar} onSubmit={filter}>
          <label className={styles.field}>
            <span>검색</span>
            <input
              placeholder="Client 이름 또는 설명"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Site</span>
            <select
              value={filterSiteId}
              onChange={(event) => setFilterSiteId(event.target.value)}
            >
              <option value="">전체 Site</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>유형</span>
            <select
              value={filterType}
              onChange={(event) =>
                setFilterType(event.target.value as ApiClientType | '')
              }
            >
              <option value="">전체</option>
              {API_CLIENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>상태</span>
            <select
              value={filterStatus}
              onChange={(event) =>
                setFilterStatus(event.target.value as ApiClientStatus | '')
              }
            >
              <option value="">전체</option>
              {API_CLIENT_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button className={styles.secondaryButton} disabled={loading} type="submit">
            조회
          </button>
        </form>
      </section>

      {error ? <p className={styles.error}>{error}</p> : null}
      {!loading && clients.length === 0 ? (
        <div className={styles.empty}>조건에 맞는 API Client가 없습니다.</div>
      ) : (
        <section className={styles.cardGrid} aria-label="API Client 목록">
          {clients.map((client) => (
            <article className={styles.card} key={client.id}>
              <div>
                <div className={styles.cardHeader}>
                  <span className={styles.typePill}>{apiClientTypeLabel(client.type)}</span>
                  <span className={styles.statusPill} data-status={client.status}>
                    {apiClientStatusLabel(client.status)}
                  </span>
                </div>
                <h2>{client.name}</h2>
                <p>{client.description ?? '설명이 등록되지 않았습니다.'}</p>
              </div>
              <dl className={styles.metaGrid}>
                <div>
                  <dt>Site</dt>
                  <dd>{client.siteIds.length}</dd>
                </div>
                <div>
                  <dt>Scope</dt>
                  <dd>{client.scopes.length}</dd>
                </div>
                <div>
                  <dt>Rate</dt>
                  <dd>{client.rateLimitPerMinute}/min</dd>
                </div>
                <div>
                  <dt>Keys</dt>
                  <dd>{client.keys.length}</dd>
                </div>
              </dl>
              <Link className={styles.secondaryLink} href={`/admin/api-clients/${client.id}`}>
                Credential 관리
              </Link>
            </article>
          ))}
        </section>
      )}
      <small className={styles.muted} aria-hidden="true">
        {buildApiClientListPath({ search, status: filterStatus || undefined })}
      </small>
    </div>
  );
}

function ApiClientCreateForm({
  sites,
  onCreated,
}: Readonly<{
  sites: readonly Site[];
  onCreated: (client: ApiClient, credential: ApiClientCredential) => void;
}>) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ApiClientType>('delivery');
  const [rateLimit, setRateLimit] = useState(600);
  const [requireOrigin, setRequireOrigin] = useState(false);
  const [siteIds, setSiteIds] = useState<readonly string[]>([]);
  const [scopes, setScopes] = useState<readonly ApiClientScope[]>(
    getApiClientScopes('delivery'),
  );
  const [origins, setOrigins] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);

    try {
      const result = await createApiClient({
        name,
        description,
        type,
        rateLimitPerMinute: rateLimit,
        requireOrigin,
        siteIds,
        scopes,
        allowedOrigins: parseAllowedOrigins(origins),
        expiresAt: toOptionalIsoDate(expiresAt),
      });
      onCreated(result.client, result.credential);
      setName('');
      setDescription('');
      setSiteIds([]);
      setOrigins('');
      setExpiresAt('');
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>API Client 생성</h2>
          <p>첫 Key 원문은 생성 직후 한 번만 표시됩니다.</p>
        </div>
      </div>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>이름</span>
            <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>유형</span>
            <select
              value={type}
              onChange={(event) => {
                const nextType = event.target.value as ApiClientType;
                setType(nextType);
                setScopes(getApiClientScopes(nextType));
              }}
            >
              {API_CLIENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>분당 요청 제한</span>
            <input min={1} max={100000} required type="number" value={rateLimit} onChange={(event) => setRateLimit(Number(event.target.value))} />
          </label>
          <label className={styles.field}>
            <span>Key 만료 시각</span>
            <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          </label>
          <label className={`${styles.field} ${styles.fullWidth}`}>
            <span>설명</span>
            <textarea maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
        </div>

        <SiteAccessSelector sites={sites} value={siteIds} onChange={setSiteIds} />
        <ScopeSelector type={type} value={scopes} onChange={setScopes} />

        <label className={styles.field}>
          <span>Allowed Origin · 한 줄에 하나</span>
          <textarea
            placeholder={'https://blog.example.com\nhttps://preview.example.com'}
            value={origins}
            onChange={(event) => setOrigins(event.target.value)}
          />
        </label>
        <label className={styles.toggleField}>
          <input
            checked={requireOrigin}
            type="checkbox"
            onChange={(event) => setRequireOrigin(event.target.checked)}
          />
          <span>Origin Header를 필수로 요구</span>
        </label>

        {error ? <p className={styles.error}>{error}</p> : null}
        <button
          className={styles.primaryButton}
          disabled={busy || siteIds.length === 0 || scopes.length === 0}
          type="submit"
        >
          {busy ? '생성 중…' : 'API Client와 첫 Key 생성'}
        </button>
      </form>
    </section>
  );
}

function readError(error: unknown): string {
  if (error instanceof AtlasApiError) {
    return `${error.problem.detail}${error.requestId ? ` · 요청 ID ${error.requestId}` : ''}`;
  }

  return 'API Client 요청을 처리하지 못했습니다.';
}
