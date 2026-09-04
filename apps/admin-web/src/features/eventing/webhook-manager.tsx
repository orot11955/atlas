'use client';

import { useEffect, useMemo, useState } from 'react';

import { AtlasApiError } from '../../lib/api';
import { loadSites } from '../sites/site-api';
import type { Site } from '../sites/site-types';
import {
  createWebhookEndpoint,
  loadOutboxEvents,
  loadWebhookDeliveries,
  loadWebhookEndpoints,
  retryOutboxEvent,
  retryWebhookDelivery,
  rotateWebhookSecret,
  setWebhookEndpointEnabled,
  updateWebhookEndpoint,
} from './eventing-api';
import type {
  OutboxEvent,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEventType,
} from './eventing-types';
import { WEBHOOK_EVENT_OPTIONS } from './eventing-types';
import styles from './eventing.module.css';

export function WebhookManager() {
  const [sites, setSites] = useState<readonly Site[]>([]);
  const [endpoints, setEndpoints] = useState<readonly WebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<readonly WebhookDelivery[]>([]);
  const [outbox, setOutbox] = useState<readonly OutboxEvent[]>([]);
  const [siteId, setSiteId] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<readonly WebhookEventType[]>([
    'content.published',
    'content.unpublished',
  ]);
  const [selectedEndpointId, setSelectedEndpointId] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<string>();
  const [working, setWorking] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const selectedEndpoint = useMemo(
    () => endpoints.find((endpoint) => endpoint.id === selectedEndpointId),
    [endpoints, selectedEndpointId],
  );

  useEffect(() => {
    void reloadAll();
  }, []);

  async function reloadAll() {
    setWorking('reload');
    setError(undefined);

    try {
      const [siteResult, nextEndpoints, nextDeliveries, nextOutbox] = await Promise.all([
        loadSites({ limit: 100 }),
        loadWebhookEndpoints(),
        loadWebhookDeliveries({ limit: 100 }),
        loadOutboxEvents(50),
      ]);
      setSites(siteResult.items.filter((site) => site.status !== 'archived'));
      setEndpoints(nextEndpoints);
      setDeliveries(nextDeliveries);
      setOutbox(nextOutbox);
      setSelectedEndpointId((current) =>
        current && nextEndpoints.some((endpoint) => endpoint.id === current) ? current : '',
      );
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function createEndpoint() {
    if (!siteId || !name.trim() || !url.trim() || events.length === 0) {
      setError('Site, 이름, URL과 하나 이상의 Event를 입력하세요.');
      return;
    }

    setWorking('create');
    setError(undefined);
    setMessage(undefined);
    setRevealedSecret(undefined);

    try {
      const result = await createWebhookEndpoint({
        siteId,
        name: name.trim(),
        url: url.trim(),
        subscribedEvents: events,
      });
      setRevealedSecret(result.secret);
      setMessage('Webhook Endpoint를 생성했습니다. Secret은 지금 한 번만 표시됩니다.');
      setName('');
      setUrl('');
      await reloadAll();
      setSelectedEndpointId(result.endpoint.id);
    } catch (caught) {
      setError(readError(caught));
      setWorking(undefined);
    }
  }

  async function saveEndpoint(endpoint: WebhookEndpoint, next: EditableEndpoint) {
    setWorking(`save-${endpoint.id}`);
    setError(undefined);
    setMessage(undefined);

    try {
      await updateWebhookEndpoint(endpoint.id, {
        version: endpoint.version,
        name: next.name,
        url: next.url,
        subscribedEvents: next.events,
      });
      setMessage('Webhook Endpoint 설정을 저장했습니다.');
      await reloadAll();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function toggleEndpoint(endpoint: WebhookEndpoint) {
    const enabling = endpoint.status !== 'active';
    setWorking(`status-${endpoint.id}`);
    setError(undefined);
    setMessage(undefined);

    try {
      await setWebhookEndpointEnabled(endpoint.id, endpoint.version, enabling);
      setMessage(
        enabling ? 'Webhook Endpoint를 활성화했습니다.' : 'Webhook Endpoint를 중지했습니다.',
      );
      await reloadAll();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function rotate(endpoint: WebhookEndpoint) {
    if (!window.confirm('기존 Webhook Secret을 즉시 교체할까요?')) return;
    setWorking(`rotate-${endpoint.id}`);
    setError(undefined);
    setMessage(undefined);
    setRevealedSecret(undefined);

    try {
      const result = await rotateWebhookSecret(endpoint.id, endpoint.version);
      setRevealedSecret(result.secret);
      setMessage('Secret을 교체했습니다. 새 Secret은 지금 한 번만 표시됩니다.');
      await reloadAll();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function retryDelivery(delivery: WebhookDelivery) {
    setWorking(`delivery-${delivery.id}`);
    setError(undefined);
    setMessage(undefined);

    try {
      const retry = await retryWebhookDelivery(delivery.id);
      setMessage(`Webhook Delivery attempt ${retry.attemptNumber}을 요청했습니다.`);
      await reloadAll();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  async function retryOutbox(event: OutboxEvent) {
    setWorking(`outbox-${event.id}`);
    setError(undefined);
    setMessage(undefined);

    try {
      await retryOutboxEvent(event.id);
      setMessage('Dead Outbox Event 재처리를 요청했습니다.');
      await reloadAll();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setWorking(undefined);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className="eyebrow">EVENTING · OUTBOX · WEBHOOK</p>
          <h1>Webhook Delivery</h1>
          <p>
            Site별 Endpoint, HMAC Secret, Delivery Attempt와 Transactional Outbox 상태를 관리합니다.
          </p>
        </div>
        <button
          className={styles.secondary}
          disabled={working !== undefined}
          type="button"
          onClick={reloadAll}
        >
          {working === 'reload' ? '새로고침 중…' : '새로고침'}
        </button>
      </header>

      {revealedSecret ? (
        <section className={styles.secretPanel}>
          <div>
            <strong>Webhook Secret · 1회 표시</strong>
            <p>수신 서버의 Secret Store에 즉시 저장하세요. 다시 조회할 수 없습니다.</p>
          </div>
          <code>{revealedSecret}</code>
          <button
            className={styles.secondary}
            type="button"
            onClick={() => navigator.clipboard.writeText(revealedSecret)}
          >
            복사
          </button>
        </section>
      ) : null}

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Endpoint 생성</h2>
            <p>운영 기본 정책은 HTTPS와 Public Network만 허용합니다.</p>
          </div>
        </div>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Site</span>
            <select value={siteId} onChange={(event) => setSiteId(event.target.value)}>
              <option value="">Site 선택</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name} · {site.key}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Name</span>
            <input
              maxLength={120}
              placeholder="Primary Blog Receiver"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className={`${styles.field} ${styles.full}`}>
            <span>URL</span>
            <input
              maxLength={2048}
              placeholder="https://blog.example.com/hooks/atlas"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <fieldset className={`${styles.eventOptions} ${styles.full}`}>
            <legend>Subscribed Events</legend>
            {WEBHOOK_EVENT_OPTIONS.map((option) => (
              <label key={option.value}>
                <input
                  checked={events.includes(option.value)}
                  type="checkbox"
                  onChange={() => setEvents(toggleEvent(events, option.value))}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        </div>
        <button
          className={styles.button}
          disabled={working !== undefined}
          type="button"
          onClick={createEndpoint}
        >
          {working === 'create' ? '생성 중…' : 'Endpoint 생성'}
        </button>
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Endpoints</h2>
            <p>Secret 원문과 내부 암호화 값은 목록에 포함되지 않습니다.</p>
          </div>
        </div>
        <div className={styles.endpointGrid}>
          {endpoints.length === 0 ? (
            <div className={styles.empty}>등록된 Webhook Endpoint가 없습니다.</div>
          ) : null}
          {endpoints.map((endpoint) => (
            <EndpointCard
              endpoint={endpoint}
              key={endpoint.id}
              selected={selectedEndpointId === endpoint.id}
              working={working}
              onRotate={() => rotate(endpoint)}
              onSave={(next) => saveEndpoint(endpoint, next)}
              onSelect={() => setSelectedEndpointId(endpoint.id)}
              onToggle={() => toggleEndpoint(endpoint)}
            />
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Delivery Attempts</h2>
            <p>
              {selectedEndpoint
                ? `${selectedEndpoint.name} 선택됨 · 전체 Delivery도 함께 표시`
                : '최근 Delivery 100개'}
            </p>
          </div>
        </div>
        <div className={styles.records}>
          {deliveries.length === 0 ? (
            <div className={styles.empty}>아직 Delivery가 없습니다.</div>
          ) : null}
          {deliveries.map((delivery) => (
            <article className={styles.record} key={delivery.id}>
              <div>
                <strong>{delivery.eventType}</strong>
                <p>
                  {delivery.endpointName} · Attempt {delivery.attemptCount}
                </p>
                {delivery.lastError ? (
                  <p className={styles.errorText}>{delivery.lastError}</p>
                ) : null}
                {delivery.lastResponseExcerpt ? <code>{delivery.lastResponseExcerpt}</code> : null}
              </div>
              <div className={styles.recordMeta}>
                <span data-status={delivery.status}>{delivery.status}</span>
                <time dateTime={delivery.createdAt}>{formatDate(delivery.createdAt)}</time>
                {delivery.status === 'dead' || delivery.status === 'retry_scheduled' ? (
                  <button
                    className={styles.secondary}
                    disabled={working !== undefined}
                    type="button"
                    onClick={() => retryDelivery(delivery)}
                  >
                    {working === `delivery-${delivery.id}` ? '요청 중…' : '재전송'}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Transactional Outbox</h2>
            <p>Publication Transaction에서 생성된 Event의 Relay 상태입니다.</p>
          </div>
        </div>
        <div className={styles.records}>
          {outbox.length === 0 ? (
            <div className={styles.empty}>Outbox Event가 없습니다.</div>
          ) : null}
          {outbox.map((event) => (
            <article className={styles.record} key={event.id}>
              <div>
                <strong>{event.eventType}</strong>
                <p>
                  {event.aggregateType} · {event.aggregateId}
                </p>
                {event.lastError ? <p className={styles.errorText}>{event.lastError}</p> : null}
              </div>
              <div className={styles.recordMeta}>
                <span data-status={event.status}>{event.status}</span>
                <time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>
                {event.status === 'dead' ? (
                  <button
                    className={styles.secondary}
                    disabled={working !== undefined}
                    type="button"
                    onClick={() => retryOutbox(event)}
                  >
                    재처리
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <div aria-live="polite">
        {message ? <p className={styles.success}>{message}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
      </div>
    </div>
  );
}

interface EditableEndpoint {
  name: string;
  url: string;
  events: readonly WebhookEventType[];
}

function EndpointCard({
  endpoint,
  selected,
  working,
  onRotate,
  onSave,
  onSelect,
  onToggle,
}: Readonly<{
  endpoint: WebhookEndpoint;
  selected: boolean;
  working?: string;
  onRotate: () => void;
  onSave: (next: EditableEndpoint) => void;
  onSelect: () => void;
  onToggle: () => void;
}>) {
  const [name, setName] = useState(endpoint.name);
  const [url, setUrl] = useState(endpoint.url);
  const [events, setEvents] = useState(endpoint.subscribedEvents);

  useEffect(() => {
    setName(endpoint.name);
    setUrl(endpoint.url);
    setEvents(endpoint.subscribedEvents);
  }, [endpoint]);

  return (
    <article className={styles.endpoint} data-selected={selected} onClick={onSelect}>
      <div className={styles.endpointTitle}>
        <div>
          <strong>{endpoint.siteName ?? endpoint.siteKey ?? endpoint.siteId}</strong>
          <p>
            Failures {endpoint.consecutiveFailureCount} · v{endpoint.version}
          </p>
        </div>
        <span data-status={endpoint.status}>{endpoint.status}</span>
      </div>
      <label className={styles.field}>
        <span>Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className={styles.field}>
        <span>URL</span>
        <input value={url} onChange={(event) => setUrl(event.target.value)} />
      </label>
      <fieldset className={styles.eventOptions}>
        <legend>Events</legend>
        {WEBHOOK_EVENT_OPTIONS.map((option) => (
          <label key={option.value}>
            <input
              checked={events.includes(option.value)}
              type="checkbox"
              onChange={() => setEvents(toggleEvent(events, option.value))}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <div className={styles.actions}>
        <button
          className={styles.secondary}
          disabled={working !== undefined || events.length === 0}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSave({ name, url, events });
          }}
        >
          저장
        </button>
        <button
          className={styles.secondary}
          disabled={working !== undefined}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRotate();
          }}
        >
          Secret 교체
        </button>
        <button
          className={endpoint.status === 'active' ? styles.danger : styles.button}
          disabled={working !== undefined}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          {endpoint.status === 'active' ? '중지' : '활성화'}
        </button>
      </div>
    </article>
  );
}

function toggleEvent(
  current: readonly WebhookEventType[],
  value: WebhookEventType,
): readonly WebhookEventType[] {
  return current.includes(value) ? current.filter((event) => event !== value) : [...current, value];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function readError(error: unknown): string {
  if (error instanceof AtlasApiError) {
    return `${error.problem.detail}${error.requestId ? ` · 요청 ID ${error.requestId}` : ''}`;
  }
  return error instanceof Error ? error.message : 'Eventing 요청을 처리하지 못했습니다.';
}
