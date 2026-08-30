'use client';

import { useState } from 'react';

import type { Site } from '../sites/site-types';
import {
  API_CLIENT_SCOPE_OPTIONS,
  type ApiClientCredential,
  type ApiClientScope,
  type ApiClientType,
} from './api-client-types';
import styles from './api-clients.module.css';

export function CredentialPanel({
  credential,
  onDismiss,
}: Readonly<{
  credential: ApiClientCredential;
  onDismiss: () => void;
}>) {
  const [message, setMessage] = useState<string>();

  async function copy() {
    try {
      await navigator.clipboard.writeText(credential.apiKey);
      setMessage('API Key를 복사했습니다.');
    } catch {
      setMessage('복사하지 못했습니다. 직접 선택해 저장하세요.');
    }
  }

  return (
    <section className={styles.secretPanel} aria-label="새 API Key">
      <div>
        <p className="eyebrow">ONE-TIME CREDENTIAL</p>
        <h2>지금 API Key를 저장하세요</h2>
        <p>
          이 원문은 다시 조회할 수 없습니다. Secret Store 또는 배포 환경 Secret에
          보관하세요.
        </p>
      </div>
      <code className={styles.secretValue}>{credential.apiKey}</code>
      <div className={styles.actions}>
        <button className={styles.primaryButton} type="button" onClick={copy}>
          API Key 복사
        </button>
        <button className={styles.secondaryButton} type="button" onClick={onDismiss}>
          저장 완료
        </button>
      </div>
      {credential.previousKeyGraceExpiresAt ? (
        <small>
          이전 Key 유예 만료: {formatDate(credential.previousKeyGraceExpiresAt)}
        </small>
      ) : null}
      {message ? <p className={styles.message}>{message}</p> : null}
    </section>
  );
}

export function SiteAccessSelector({
  sites,
  value,
  disabled,
  onChange,
}: Readonly<{
  sites: readonly Site[];
  value: readonly string[];
  disabled?: boolean;
  onChange: (siteIds: readonly string[]) => void;
}>) {
  return (
    <fieldset className={styles.selectorGroup} disabled={disabled}>
      <legend>Site 접근 범위</legend>
      {sites.length === 0 ? (
        <p className={styles.muted}>먼저 Site를 등록하세요.</p>
      ) : (
        <div className={styles.checkGrid}>
          {sites.map((site) => (
            <label className={styles.checkItem} key={site.id}>
              <input
                checked={value.includes(site.id)}
                type="checkbox"
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...value, site.id]
                      : value.filter((siteId) => siteId !== site.id),
                  )
                }
              />
              <span>
                <strong>{site.name}</strong>
                <small>{site.key} · {site.status}</small>
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export function ScopeSelector({
  type,
  value,
  disabled,
  onChange,
}: Readonly<{
  type: ApiClientType;
  value: readonly ApiClientScope[];
  disabled?: boolean;
  onChange: (scopes: readonly ApiClientScope[]) => void;
}>) {
  const options = API_CLIENT_SCOPE_OPTIONS.filter((option) =>
    option.types.includes(type),
  );

  return (
    <fieldset className={styles.selectorGroup} disabled={disabled}>
      <legend>Permission Scope</legend>
      <div className={styles.checkGrid}>
        {options.map((option) => (
          <label className={styles.checkItem} key={option.value}>
            <input
              checked={value.includes(option.value)}
              type="checkbox"
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...value, option.value]
                    : value.filter((scope) => scope !== option.value),
                )
              }
            />
            <span>
              <strong>{option.value}</strong>
              <small>{option.label}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
