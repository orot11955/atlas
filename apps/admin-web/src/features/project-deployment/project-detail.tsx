'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { loadSites } from '../sites/site-api';
import type { Site } from '../sites/site-types';
import {
  changeProjectStatus,
  connectRepository,
  connectServiceEnvironment,
  createService,
  loadEnvironments,
  loadProject,
  updateProject,
} from './project-deployment-api';
import type {
  Environment,
  ProjectDetail as ProjectDetailType,
  Service,
} from './project-deployment-types';
import { formatDate } from './project-manager';
import styles from './project-deployment.module.css';

export function ProjectDetail({ projectId }: Readonly<{ projectId: string }>) {
  const [detail, setDetail] = useState<ProjectDetailType>();
  const [sites, setSites] = useState<readonly Site[]>([]);
  const [environments, setEnvironments] = useState<readonly Environment[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void refresh();
  }, [projectId]);

  async function refresh() {
    setLoading(true);
    setError(undefined);
    try {
      const [projectResult, siteResult, environmentResult] = await Promise.all([
        loadProject(projectId),
        loadSites({ limit: 100 }),
        loadEnvironments(),
      ]);
      setDetail(projectResult);
      setSites(siteResult.items.filter((site) => site.status !== 'archived'));
      setEnvironments(environmentResult);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setLoading(false);
    }
  }

  if (loading && !detail) {
    return <div className={styles.empty}>Project를 불러오는 중입니다.</div>;
  }

  if (!detail) {
    return <div className={styles.empty}>{error ?? 'Project를 찾을 수 없습니다.'}</div>;
  }

  const project = detail.project;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className="eyebrow">PROJECT DETAIL</p>
          <h1>{project.name}</h1>
          <p>
            {project.key} · Site {project.siteIds.length}개
          </p>
        </div>
        <div className={styles.actions}>
          <Link
            className={styles.secondaryLink}
            href={`/admin/deployments?projectId=${project.id}`}
          >
            배포 보기
          </Link>
          {project.status !== 'archived' ? (
            <button
              className={styles.dangerButton}
              onClick={() => void transition('archived')}
              type="button"
            >
              보관
            </button>
          ) : null}
        </div>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}

      <ProjectSettingsForm detail={detail} sites={sites} onUpdated={refresh} />

      <div className={styles.twoColumn}>
        <RepositoryForm projectId={project.id} onCreated={refresh} />
        <ServiceForm projectId={project.id} onCreated={refresh} />
      </div>

      <ServiceEnvironmentForm
        projectId={project.id}
        services={detail.services}
        environments={environments}
        onCreated={refresh}
      />

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Service와 Environment</h2>
            <p>Health URL은 여기에서만 사전 등록할 수 있습니다.</p>
          </div>
        </div>
        <div className={styles.cardGrid}>
          {detail.services.map((service) => {
            const connections = detail.serviceEnvironments.filter(
              (record) => record.serviceId === service.id,
            );
            return (
              <article className={styles.card} key={service.id}>
                <div className={styles.cardHeader}>
                  <span className={styles.statusPill} data-status={service.status}>
                    {service.status}
                  </span>
                  <span className={styles.muted}>{service.type}</span>
                </div>
                <h3>{service.name}</h3>
                <p>{service.key}</p>
                {connections.map((connection) => {
                  const environment = environments.find(
                    (item) => item.id === connection.environmentId,
                  );
                  return (
                    <div className={styles.inlineMeta} key={connection.id}>
                      <strong>{environment?.name ?? connection.environmentId.slice(0, 8)}</strong>
                      <span>{connection.healthUrl ?? 'Health URL 미등록'}</span>
                      <span>
                        Current Release: {connection.currentReleaseId?.slice(0, 8) ?? '없음'}
                      </span>
                    </div>
                  );
                })}
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Repository</h2>
            <p>Credential은 저장하지 않고 연결 Metadata만 관리합니다.</p>
          </div>
        </div>
        <div className={styles.tableList}>
          {detail.repositories.map((repository) => (
            <div className={styles.tableRow} key={repository.id}>
              <span>{repository.provider}</span>
              <span>{repository.repositoryFullName ?? repository.repositoryUrl}</span>
              <span>{repository.defaultBranch}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Project Timeline</h2>
            <p>Release, Deployment, Health 상태 이력을 시간순으로 추적합니다.</p>
          </div>
        </div>
        <ol className={styles.timeline}>
          {detail.timeline.map((event) => (
            <li key={event.id}>
              <div>
                <strong>{event.type}</strong>
                {event.message ? <p>{event.message}</p> : null}
              </div>
              <time>{formatDate(event.occurredAt)}</time>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );

  async function transition(status: 'active' | 'paused' | 'archived') {
    if (!detail) return;
    setError(undefined);
    try {
      await changeProjectStatus(detail.project.id, status, detail.project.version);
      await refresh();
    } catch (caught) {
      setError(readError(caught));
    }
  }
}

function ProjectSettingsForm({
  detail,
  sites,
  onUpdated,
}: Readonly<{
  detail: ProjectDetailType;
  sites: readonly Site[];
  onUpdated: () => Promise<void>;
}>) {
  const [name, setName] = useState(detail.project.name);
  const [description, setDescription] = useState(detail.project.description ?? '');
  const [siteIds, setSiteIds] = useState<readonly string[]>(detail.project.siteIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await updateProject(detail.project.id, {
        version: detail.project.version,
        name,
        description: description.trim() || undefined,
        siteIds,
      });
      await onUpdated();
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
          <h2>Project 설정</h2>
          <p>Site Scope 변경은 다음 Integration Callback부터 적용됩니다.</p>
        </div>
      </div>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>
          <span>이름</span>
          <input required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className={styles.field}>
          <span>설명</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <fieldset className={styles.fieldset}>
          <legend>연결 Site</legend>
          <div className={styles.checkboxGrid}>
            {sites.map((site) => (
              <label key={site.id}>
                <input
                  type="checkbox"
                  checked={siteIds.includes(site.id)}
                  onChange={(event) =>
                    setSiteIds((current) =>
                      event.target.checked
                        ? [...current, site.id]
                        : current.filter((id) => id !== site.id),
                    )
                  }
                />
                {site.name}
              </label>
            ))}
          </div>
        </fieldset>
        {error ? <p className={styles.error}>{error}</p> : null}
        <button className={styles.primaryButton} disabled={busy || siteIds.length === 0}>
          {busy ? '저장 중…' : '설정 저장'}
        </button>
      </form>
    </section>
  );
}

function RepositoryForm({
  projectId,
  onCreated,
}: Readonly<{ projectId: string; onCreated: () => Promise<void> }>) {
  const [provider, setProvider] = useState<'gitea' | 'github' | 'gitlab' | 'other'>('gitea');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [repositoryFullName, setRepositoryFullName] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('develop');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await connectRepository(projectId, {
        provider,
        repositoryUrl,
        repositoryFullName: repositoryFullName.trim() || undefined,
        defaultBranch,
      });
      setRepositoryUrl('');
      setRepositoryFullName('');
      await onCreated();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel}>
      <h2>Repository 연결</h2>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>
          <span>Provider</span>
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value as typeof provider)}
          >
            <option value="gitea">Gitea</option>
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Repository URL</span>
          <input
            required
            value={repositoryUrl}
            onChange={(event) => setRepositoryUrl(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Full name</span>
          <input
            value={repositoryFullName}
            onChange={(event) => setRepositoryFullName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>기본 Branch</span>
          <input
            required
            value={defaultBranch}
            onChange={(event) => setDefaultBranch(event.target.value)}
          />
        </label>
        {error ? <p className={styles.error}>{error}</p> : null}
        <button className={styles.primaryButton} disabled={busy}>
          연결
        </button>
      </form>
    </section>
  );
}

function ServiceForm({
  projectId,
  onCreated,
}: Readonly<{ projectId: string; onCreated: () => Promise<void> }>) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<Service['type']>('web');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await createService(projectId, { key, name, type });
      setKey('');
      setName('');
      await onCreated();
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel}>
      <h2>Service 생성</h2>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>
          <span>Key</span>
          <input required value={key} onChange={(event) => setKey(event.target.value)} />
        </label>
        <label className={styles.field}>
          <span>이름</span>
          <input required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className={styles.field}>
          <span>유형</span>
          <select value={type} onChange={(event) => setType(event.target.value as Service['type'])}>
            <option value="web">Web</option>
            <option value="api">API</option>
            <option value="worker">Worker</option>
            <option value="database">Database</option>
            <option value="other">Other</option>
          </select>
        </label>
        {error ? <p className={styles.error}>{error}</p> : null}
        <button className={styles.primaryButton} disabled={busy}>
          생성
        </button>
      </form>
    </section>
  );
}

function ServiceEnvironmentForm({
  projectId,
  services,
  environments,
  onCreated,
}: Readonly<{
  projectId: string;
  services: readonly Service[];
  environments: readonly Environment[];
  onCreated: () => Promise<void>;
}>) {
  const [serviceId, setServiceId] = useState('');
  const [environmentId, setEnvironmentId] = useState('');
  const [healthUrl, setHealthUrl] = useState('');
  const [healthTimeoutMs, setHealthTimeoutMs] = useState(5_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await connectServiceEnvironment(projectId, serviceId, {
        environmentId,
        healthUrl: healthUrl.trim() || undefined,
        healthTimeoutMs,
      });
      setHealthUrl('');
      await onCreated();
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
          <h2>Service → Environment 연결</h2>
          <p>Callback이 임의 URL을 넘기지 못하도록 Health URL을 여기에서 고정합니다.</p>
        </div>
      </div>
      <form className={styles.formGrid} onSubmit={submit}>
        <label className={styles.field}>
          <span>Service</span>
          <select required value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
            <option value="">선택</option>
            {services.map((service) => (
              <option value={service.id} key={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Environment</span>
          <select
            required
            value={environmentId}
            onChange={(event) => setEnvironmentId(event.target.value)}
          >
            <option value="">선택</option>
            {environments.map((environment) => (
              <option value={environment.id} key={environment.id}>
                {environment.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Health URL</span>
          <input
            value={healthUrl}
            onChange={(event) => setHealthUrl(event.target.value)}
            placeholder="https://.../health"
          />
        </label>
        <label className={styles.field}>
          <span>Timeout (ms)</span>
          <input
            type="number"
            min={500}
            max={60000}
            value={healthTimeoutMs}
            onChange={(event) => setHealthTimeoutMs(Number(event.target.value))}
          />
        </label>
        {error ? <p className={styles.error}>{error}</p> : null}
        <button className={styles.primaryButton} disabled={busy || !serviceId || !environmentId}>
          연결
        </button>
      </form>
    </section>
  );
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
}
