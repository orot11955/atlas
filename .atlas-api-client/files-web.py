FILES = {
    'apps/admin-web/src/features/api-clients/api-client-types.ts': r'''export type ApiClientStatus = 'active' | 'disabled' | 'revoked';
export type ApiClientKeyStatus = 'active' | 'grace' | 'revoked';
export type ApiClientScope = 'site:read' | 'content:read' | 'feed:read';

export interface ApiClientKey {
  id: string;
  keyPrefix: string;
  status: ApiClientKeyStatus;
  notBefore: string;
  expiresAt?: string;
  graceExpiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface ApiClient {
  id: string;
  workspaceId: string;
  siteId: string;
  name: string;
  status: ApiClientStatus;
  scopes: readonly ApiClientScope[];
  allowedOrigins: readonly string[];
  rateLimitPerMinute: number;
  version: number;
  lastUsedAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
  keys: readonly ApiClientKey[];
}

export interface IssuedApiClientKey {
  id: string;
  token: string;
  keyPrefix: string;
  status: ApiClientKeyStatus;
  notBefore: string;
  expiresAt?: string;
  createdAt: string;
}

export interface IssuedApiClientResult {
  client: ApiClient;
  issuedKey: IssuedApiClientKey;
}

export interface ApiEnvelope<T> {
  data: T;
}

export const API_CLIENT_SCOPE_OPTIONS: readonly Readonly<{
  value: ApiClientScope;
  label: string;
  description: string;
}>[] = Object.freeze([
  {
    value: 'site:read',
    label: 'Site 읽기',
    description: 'Site Identity와 공개 설정을 읽습니다.',
  },
  {
    value: 'content:read',
    label: '콘텐츠 읽기',
    description: '향후 게시된 콘텐츠 Delivery API에 사용합니다.',
  },
  {
    value: 'feed:read',
    label: 'Feed 읽기',
    description: '향후 RSS·JSON Feed Delivery API에 사용합니다.',
  },
]);
''',
    'apps/admin-web/src/features/api-clients/api-client-form.ts': r'''import type { ApiClientScope } from './api-client-types';

export function parseAllowedOriginsText(value: string): readonly string[] {
  return Object.freeze(
    [...new Set(
      value
        .split(/\r?\n/gu)
        .map((origin) => origin.trim())
        .filter(Boolean),
    )].sort(),
  );
}

export function formatAllowedOrigins(origins: readonly string[]): string {
  return origins.join('\n');
}

export function toggleApiClientScope(
  current: readonly ApiClientScope[],
  scope: ApiClientScope,
  checked: boolean,
): readonly ApiClientScope[] {
  const next = new Set(current);

  if (checked) {
    next.add(scope);
  } else {
    next.delete(scope);
  }

  return Object.freeze([...next].sort() as ApiClientScope[]);
}
''',
    'apps/admin-web/src/features/api-clients/api-client-api.ts': r'''import { createAdminApiClient } from '../../lib/api';
import type {
  ApiClient,
  ApiClientScope,
  ApiClientStatus,
  ApiEnvelope,
  IssuedApiClientResult,
} from './api-client-types';

export interface ApiClientInput {
  name: string;
  scopes: readonly ApiClientScope[];
  allowedOrigins: readonly string[];
  rateLimitPerMinute: number;
}

function client() {
  return createAdminApiClient();
}

export async function loadApiClients(siteId: string): Promise<readonly ApiClient[]> {
  const response = await client().get<ApiEnvelope<readonly ApiClient[]>>(
    `/sites/${encodeURIComponent(siteId)}/api-clients`,
  );
  return response.data;
}

export async function createApiClient(
  siteId: string,
  input: ApiClientInput,
): Promise<IssuedApiClientResult> {
  const response = await client().post<ApiEnvelope<IssuedApiClientResult>>(
    `/sites/${encodeURIComponent(siteId)}/api-clients`,
    input,
  );
  return response.data;
}

export async function updateApiClient(
  siteId: string,
  apiClientId: string,
  input: ApiClientInput & { version: number },
): Promise<ApiClient> {
  const response = await client().patch<ApiEnvelope<ApiClient>>(
    `/sites/${encodeURIComponent(siteId)}/api-clients/${encodeURIComponent(apiClientId)}`,
    input,
  );
  return response.data;
}

export async function rotateApiClientKey(
  siteId: string,
  apiClientId: string,
  graceSeconds = 3_600,
): Promise<IssuedApiClientResult> {
  const response = await client().post<ApiEnvelope<IssuedApiClientResult>>(
    `/sites/${encodeURIComponent(siteId)}/api-clients/${encodeURIComponent(apiClientId)}/rotate`,
    { graceSeconds },
  );
  return response.data;
}

export async function changeApiClientStatus(
  siteId: string,
  apiClient: Pick<ApiClient, 'id' | 'version'>,
  status: ApiClientStatus,
): Promise<ApiClient> {
  const action = status === 'active' ? 'enable' : status === 'disabled' ? 'disable' : 'revoke';
  const response = await client().post<ApiEnvelope<ApiClient>>(
    `/sites/${encodeURIComponent(siteId)}/api-clients/${encodeURIComponent(apiClient.id)}/${action}`,
    { version: apiClient.version },
  );
  return response.data;
}

export async function revokeApiClientKey(
  siteId: string,
  apiClientId: string,
  keyId: string,
): Promise<void> {
  await client().post<void>(
    `/sites/${encodeURIComponent(siteId)}/api-clients/${encodeURIComponent(apiClientId)}/keys/${encodeURIComponent(keyId)}/revoke`,
    undefined,
    { responseType: 'void' },
  );
}
''',
    'apps/admin-web/src/features/api-clients/api-clients.module.css': r'''.page {
  display: grid;
  gap: 24px;
}

.header,
.cardHeader,
.keyHeader,
.toolbar,
.actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.header h1,
.panel h2,
.card h2 {
  margin: 0;
}

.header p,
.panel p,
.card p,
.muted {
  color: #9ea7b5;
  line-height: 1.65;
}

.panel,
.card,
.secretPanel,
.empty {
  border: 1px solid #252a31;
  border-radius: 18px;
  background: rgba(20, 23, 28, 0.88);
}

.panel,
.card,
.secretPanel {
  padding: 22px;
}

.form,
.grid,
.list,
.keyList,
.scopeList {
  display: grid;
  gap: 16px;
}

.grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.list {
  grid-template-columns: repeat(auto-fit, minmax(330px, 1fr));
}

.field,
.scopeOption {
  display: grid;
  gap: 8px;
}

.field span,
.scopeOption strong {
  color: #d8dde5;
  font-size: 0.88rem;
}

.field input,
.field textarea {
  width: 100%;
  border: 1px solid #343b45;
  border-radius: 10px;
  background: #111419;
  color: #f4f7fb;
  font: inherit;
}

.field input {
  min-height: 44px;
  padding: 0 12px;
}

.field textarea {
  min-height: 112px;
  resize: vertical;
  padding: 12px;
}

.fullWidth {
  grid-column: 1 / -1;
}

.scopeList {
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
}

.scopeOption {
  grid-template-columns: auto 1fr;
  align-items: start;
  padding: 12px;
  border: 1px solid #303741;
  border-radius: 12px;
}

.scopeOption input {
  margin-top: 3px;
}

.scopeOption small {
  color: #8f98a5;
  line-height: 1.5;
}

.button,
.secondaryButton,
.dangerButton,
.link {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  border-radius: 10px;
  font: inherit;
  font-weight: 750;
  text-decoration: none;
  cursor: pointer;
}

.button {
  border: 1px solid #ffb13b;
  background: #ffb13b;
  color: #17110a;
}

.secondaryButton,
.link {
  border: 1px solid #343b45;
  background: #171b21;
  color: #f4f7fb;
}

.dangerButton {
  border: 1px solid rgba(245, 124, 124, 0.52);
  background: rgba(245, 124, 124, 0.08);
  color: #ff9f9f;
}

.button:disabled,
.secondaryButton:disabled,
.dangerButton:disabled {
  cursor: wait;
  opacity: 0.55;
}

.status,
.scope,
.keyStatus {
  display: inline-flex;
  width: fit-content;
  padding: 4px 8px;
  border: 1px solid #38414d;
  border-radius: 999px;
  color: #bbc5d1;
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
}

.status[data-status='active'],
.keyStatus[data-status='active'] {
  border-color: rgba(113, 213, 155, 0.5);
  color: #71d59b;
}

.keyStatus[data-status='grace'] {
  border-color: rgba(255, 177, 59, 0.55);
  color: #ffb13b;
}

.scopeRow,
.originList {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 12px;
}

.originList code,
.secretPanel code,
.keyHeader code {
  overflow-wrap: anywhere;
  color: #e4e9f0;
}

.keyItem {
  padding: 13px;
  border: 1px solid #2f353d;
  border-radius: 12px;
  background: #111419;
}

.secretPanel {
  border-color: rgba(255, 177, 59, 0.45);
}

.secretValue {
  display: block;
  margin: 14px 0;
  padding: 14px;
  border-radius: 10px;
  background: #0f1115;
}

.feedback {
  min-height: 24px;
}

.error {
  color: #ff9f9f;
}

.message {
  color: #71d59b;
}

.empty {
  padding: 44px 22px;
  color: #9ea7b5;
  text-align: center;
}

@media (max-width: 800px) {
  .header,
  .cardHeader,
  .keyHeader,
  .toolbar,
  .actions {
    align-items: stretch;
    flex-direction: column;
  }

  .grid,
  .list {
    grid-template-columns: 1fr;
  }

  .fullWidth {
    grid-column: auto;
  }
}
''',
    'apps/admin-web/src/features/api-clients/api-client-manager.tsx': r''''use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { AtlasApiError } from '../../lib/api';
import { loadSite } from '../sites/site-api';
import type { Site } from '../sites/site-types';
import {
  changeApiClientStatus,
  createApiClient,
  loadApiClients,
  revokeApiClientKey,
  rotateApiClientKey,
  updateApiClient,
} from './api-client-api';
import {
  formatAllowedOrigins,
  parseAllowedOriginsText,
  toggleApiClientScope,
} from './api-client-form';
import {
  API_CLIENT_SCOPE_OPTIONS,
  type ApiClient,
  type ApiClientScope,
  type IssuedApiClientKey,
} from './api-client-types';
import styles from './api-clients.module.css';

const DEFAULT_SCOPES: readonly ApiClientScope[] = Object.freeze([
  'site:read',
  'content:read',
]);

export function ApiClientManager({ siteId }: Readonly<{ siteId: string }>) {
  const [site, setSite] = useState<Site>();
  const [clients, setClients] = useState<readonly ApiClient[]>([]);
  const [editing, setEditing] = useState<ApiClient>();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<readonly ApiClientScope[]>(DEFAULT_SCOPES);
  const [origins, setOrigins] = useState('');
  const [rateLimit, setRateLimit] = useState('120');
  const [issuedKey, setIssuedKey] = useState<IssuedApiClientKey>();
  const [working, setWorking] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void reload();
  }, [siteId]);

  async function reload() {
    setError(undefined);

    try {
      const [nextSite, nextClients] = await Promise.all([
        loadSite(siteId),
        loadApiClients(siteId),
      ]);
      setSite(nextSite);
      setClients(nextClients);
    } catch (caught) {
      setError(readError(caught));
    }
  }

  function resetForm() {
    setEditing(undefined);
    setName('');
    setScopes(DEFAULT_SCOPES);
    setOrigins('');
    setRateLimit('120');
  }

  function beginEdit(client: ApiClient) {
    setEditing(client);
    setName(client.name);
    setScopes(client.scopes);
    setOrigins(formatAllowedOrigins(client.allowedOrigins));
    setRateLimit(String(client.rateLimitPerMinute));
    setMessage(undefined);
    setError(undefined);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(editing?.id ?? 'create');
    setMessage(undefined);
    setError(undefined);

    try {
      const input = {
        name,
        scopes,
        allowedOrigins: parseAllowedOriginsText(origins),
        rateLimitPerMinute: Number(rateLimit),
      };

      if (editing) {
        await updateApiClient(siteId, editing.id, {
          ...input,
          version: editing.version,
        });
        setMessage('API Client 정책을 저장했습니다.');
      } else {
        const result = await createApiClient(siteId, input);
        setIssuedKey(result.issuedKey);
        setMessage('API Key가 발급되었습니다. 원문은 이번 화면에서만 확인할 수 있습니다.');
      }

      resetForm();
      await reload();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function rotate(client: ApiClient) {
    if (!window.confirm('새 Key를 발급하고 현재 Key를 1시간 Grace 상태로 전환할까요?')) {
      return;
    }

    setWorking(`rotate:${client.id}`);
    setMessage(undefined);
    setError(undefined);

    try {
      const result = await rotateApiClientKey(siteId, client.id, 3_600);
      setIssuedKey(result.issuedKey);
      setMessage('새 API Key를 발급했습니다. 기존 Key는 1시간 동안만 사용할 수 있습니다.');
      await reload();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function changeStatus(
    client: ApiClient,
    status: 'active' | 'disabled' | 'revoked',
  ) {
    if (
      status === 'revoked' &&
      !window.confirm('API Client와 모든 활성 Key를 영구 폐기할까요?')
    ) {
      return;
    }

    setWorking(`${status}:${client.id}`);
    setMessage(undefined);
    setError(undefined);

    try {
      await changeApiClientStatus(siteId, client, status);
      setMessage(`API Client 상태를 ${status}(으)로 변경했습니다.`);
      await reload();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function revokeKey(client: ApiClient, keyId: string) {
    if (!window.confirm('선택한 API Key를 즉시 폐기할까요?')) {
      return;
    }

    setWorking(`key:${keyId}`);
    setMessage(undefined);
    setError(undefined);

    try {
      await revokeApiClientKey(siteId, client.id, keyId);
      setMessage('API Key를 폐기했습니다.');
      await reload();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function copyToken() {
    if (!issuedKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(issuedKey.token);
      setMessage('API Key를 클립보드에 복사했습니다.');
    } catch {
      setError('클립보드에 복사하지 못했습니다. Key를 직접 선택해 복사하세요.');
    }
  }

  if (!site && !error) {
    return <div className={styles.empty}>Site와 API Client를 불러오는 중입니다…</div>;
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className="eyebrow">SITE API CLIENT</p>
          <h1>{site?.name ?? 'API Client'}</h1>
          <p>이 Site만 접근할 수 있는 Delivery Key와 Scope·Origin·Rate Limit을 관리합니다.</p>
        </div>
        <Link className={styles.link} href={`/admin/sites/${siteId}`}>
          Site로 돌아가기
        </Link>
      </header>

      {issuedKey ? (
        <section className={styles.secretPanel} aria-live="polite">
          <div className={styles.cardHeader}>
            <div>
              <p className="eyebrow">ONE-TIME SECRET</p>
              <h2>API Key를 지금 저장하세요</h2>
              <p>페이지를 닫으면 원문을 다시 조회할 수 없습니다. 필요하면 새 Key를 회전 발급합니다.</p>
            </div>
            <button className={styles.secondaryButton} type="button" onClick={() => setIssuedKey(undefined)}>
              확인 완료
            </button>
          </div>
          <code className={styles.secretValue}>{issuedKey.token}</code>
          <button className={styles.button} type="button" onClick={copyToken}>
            API Key 복사
          </button>
        </section>
      ) : null}

      <section className={styles.panel}>
        <div className={styles.cardHeader}>
          <div>
            <h2>{editing ? 'API Client 설정 편집' : '새 API Client'}</h2>
            <p>브라우저 요청을 허용할 경우에만 Origin을 등록하고, 서버 간 호출은 빈 값으로 둡니다.</p>
          </div>
          {editing ? (
            <button className={styles.secondaryButton} type="button" onClick={resetForm}>
              편집 취소
            </button>
          ) : null}
        </div>

        <form className={styles.form} onSubmit={submit}>
          <div className={styles.grid}>
            <label className={styles.field}>
              <span>이름</span>
              <input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span>분당 요청 제한</span>
              <input required min={1} max={10000} type="number" value={rateLimit} onChange={(event) => setRateLimit(event.target.value)} />
            </label>
            <label className={`${styles.field} ${styles.fullWidth}`}>
              <span>Allowed Origins · 한 줄에 하나</span>
              <textarea placeholder="https://blog.example.com" value={origins} onChange={(event) => setOrigins(event.target.value)} />
            </label>
          </div>

          <div className={styles.scopeList}>
            {API_CLIENT_SCOPE_OPTIONS.map((option) => (
              <label className={styles.scopeOption} key={option.value}>
                <input
                  checked={scopes.includes(option.value)}
                  type="checkbox"
                  onChange={(event) =>
                    setScopes((current) =>
                      toggleApiClientScope(current, option.value, event.target.checked),
                    )
                  }
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>

          <div className={styles.feedback} aria-live="polite">
            {message ? <span className={styles.message}>{message}</span> : null}
            {error ? <span className={styles.error}>{error}</span> : null}
          </div>
          <button className={styles.button} disabled={working !== undefined || scopes.length === 0} type="submit">
            {working === (editing?.id ?? 'create')
              ? '저장 중…'
              : editing
                ? '정책 저장'
                : 'API Client 생성'}
          </button>
        </form>
      </section>

      {clients.length === 0 ? (
        <div className={styles.empty}>등록된 API Client가 없습니다.</div>
      ) : (
        <section className={styles.list} aria-label="Site API Client 목록">
          {clients.map((client) => (
            <article className={styles.card} key={client.id}>
              <div className={styles.cardHeader}>
                <div>
                  <span className={styles.status} data-status={client.status}>
                    {client.status}
                  </span>
                  <h2>{client.name}</h2>
                  <p>
                    분당 {client.rateLimitPerMinute.toLocaleString('ko-KR')}회 · Version {client.version}
                  </p>
                </div>
                <button className={styles.secondaryButton} disabled={client.status === 'revoked'} type="button" onClick={() => beginEdit(client)}>
                  설정 편집
                </button>
              </div>

              <div className={styles.scopeRow}>
                {client.scopes.map((scope) => (
                  <span className={styles.scope} key={scope}>
                    {scope}
                  </span>
                ))}
              </div>

              <div className={styles.originList}>
                {client.allowedOrigins.length > 0 ? (
                  client.allowedOrigins.map((origin) => <code key={origin}>{origin}</code>)
                ) : (
                  <span className={styles.muted}>Origin 제한 없음 · Server-to-server</span>
                )}
              </div>

              <div className={styles.keyList}>
                {client.keys.map((key) => (
                  <div className={styles.keyItem} key={key.id}>
                    <div className={styles.keyHeader}>
                      <code>{key.keyPrefix}</code>
                      <span className={styles.keyStatus} data-status={key.status}>
                        {key.status}
                      </span>
                    </div>
                    <p className={styles.muted}>
                      생성 {formatDate(key.createdAt)}
                      {key.lastUsedAt ? ` · 최근 사용 ${formatDate(key.lastUsedAt)}` : ''}
                      {key.graceExpiresAt ? ` · Grace 종료 ${formatDate(key.graceExpiresAt)}` : ''}
                    </p>
                    {key.status !== 'revoked' ? (
                      <button className={styles.dangerButton} disabled={working !== undefined} type="button" onClick={() => revokeKey(client, key.id)}>
                        {working === `key:${key.id}` ? '폐기 중…' : 'Key 즉시 폐기'}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className={styles.actions}>
                {client.status === 'active' ? (
                  <>
                    <button className={styles.secondaryButton} disabled={working !== undefined} type="button" onClick={() => rotate(client)}>
                      {working === `rotate:${client.id}` ? '회전 중…' : 'Key 회전'}
                    </button>
                    <button className={styles.secondaryButton} disabled={working !== undefined} type="button" onClick={() => changeStatus(client, 'disabled')}>
                      비활성화
                    </button>
                  </>
                ) : null}
                {client.status === 'disabled' ? (
                  <button className={styles.button} disabled={working !== undefined} type="button" onClick={() => changeStatus(client, 'active')}>
                    활성화
                  </button>
                ) : null}
                {client.status !== 'revoked' ? (
                  <button className={styles.dangerButton} disabled={working !== undefined} type="button" onClick={() => changeStatus(client, 'revoked')}>
                    영구 폐기
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      )}
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
''',
    'apps/admin-web/src/app/admin/sites/[siteId]/api-clients/page.tsx': r'''import { ApiClientManager } from '../../../../../features/api-clients/api-client-manager';

export default async function SiteApiClientsPage({
  params,
}: Readonly<{
  params: Promise<{ siteId: string }>;
}>) {
  const { siteId } = await params;
  return <ApiClientManager siteId={siteId} />;
}
''',
    'apps/admin-web/src/api-client-management.test.ts': r'''import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatAllowedOrigins,
  parseAllowedOriginsText,
  toggleApiClientScope,
} from './features/api-clients/api-client-form';

test('Allowed Origin editor trims, deduplicates and sorts values', () => {
  const origins = parseAllowedOriginsText(
    ' https://blog.example.com\nhttps://docs.example.com\nhttps://blog.example.com\n',
  );

  assert.deepEqual(origins, [
    'https://blog.example.com',
    'https://docs.example.com',
  ]);
  assert.equal(
    formatAllowedOrigins(origins),
    'https://blog.example.com\nhttps://docs.example.com',
  );
});

test('Scope editor keeps unique sorted Scope values', () => {
  const added = toggleApiClientScope(['site:read'], 'content:read', true);
  const removed = toggleApiClientScope(added, 'site:read', false);

  assert.deepEqual(added, ['content:read', 'site:read']);
  assert.deepEqual(removed, ['content:read']);
});
''',
}
