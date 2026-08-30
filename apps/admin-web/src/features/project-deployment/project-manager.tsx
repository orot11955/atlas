'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { loadSites } from '../sites/site-api';
import type { Site } from '../sites/site-types';
import {
  createEnvironment,
  createProject,
  loadDeployments,
  loadEnvironments,
  loadProjects,
} from './project-deployment-api';
import type { Deployment, Environment, EnvironmentTier, Project } from './project-deployment-types';
import styles from './project-deployment.module.css';

export function ProjectManager() {
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [sites, setSites] = useState<readonly Site[]>([]);
  const [environments, setEnvironments] = useState<readonly Environment[]>([]);
  const [deployments, setDeployments] = useState<readonly Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void loadInitial();
  }, []);

  async function loadInitial() {
    setLoading(true);
    setError(undefined);
    try {
      const [projectResult, siteResult, environmentResult, deploymentResult] = await Promise.all([
        loadProjects(),
        loadSites({ limit: 100 }),
        loadEnvironments(),
        loadDeployments({ limit: 8 }),
      ]);
      setProjects(projectResult);
      setSites(siteResult.items.filter((site) => site.status !== 'archived'));
      setEnvironments(environmentResult);
      setDeployments(deploymentResult);
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
          <p className="eyebrow">PROJECT OPERATIONS</p>
          <h1>프로젝트</h1>
          <p>Repository, Service, Environment와 CI Deployment 이력을 조회합니다.</p>
        </div>
        <Link className={styles.secondaryLink} href="/admin/deployments">
          전체 배포 보기
        </Link>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.twoColumn}>
        <CreateProjectForm
          sites={sites}
          onCreated={(project) => setProjects((current) => [project, ...current])}
        />
        <CreateEnvironmentForm
          onCreated={(environment) => setEnvironments((current) => [...current, environment])}
        />
      </div>

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>등록된 프로젝트</h2>
            <p>{loading ? '조회 중…' : `${projects.length}개 Project`}</p>
          </div>
        </div>
        {projects.length === 0 && !loading ? (
          <div className={styles.empty}>등록된 프로젝트가 없습니다.</div>
        ) : (
          <div className={styles.cardGrid}>
            {projects.map((project) => (
              <article className={styles.card} key={project.id}>
                <div className={styles.cardHeader}>
                  <span className={styles.statusPill} data-status={project.status}>
                    {projectStatusLabel(project.status)}
                  </span>
                  <span className={styles.muted}>{project.key}</span>
                </div>
                <h3>{project.name}</h3>
                <p>{project.description ?? '설명이 등록되지 않았습니다.'}</p>
                <dl className={styles.metaGrid}>
                  <div>
                    <dt>Site</dt>
                    <dd>{project.siteIds.length}</dd>
                  </div>
                  <div>
                    <dt>Version</dt>
                    <dd>{project.version}</dd>
                  </div>
                </dl>
                <Link className={styles.primaryLink} href={`/admin/projects/${project.id}`}>
                  구성과 Timeline
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>최근 배포</h2>
            <p>Deployment 상태와 Health 상태는 별도로 관리됩니다.</p>
          </div>
        </div>
        {deployments.length === 0 ? (
          <div className={styles.empty}>아직 CI Callback으로 수집된 배포가 없습니다.</div>
        ) : (
          <div className={styles.tableList}>
            {deployments.map((deployment) => (
              <Link
                className={styles.tableRow}
                href={`/admin/deployments/${deployment.id}`}
                key={deployment.id}
              >
                <span>{deployment.id.slice(0, 8)}</span>
                <span className={styles.statusPill} data-status={deployment.status}>
                  {deploymentStatusLabel(deployment.status)}
                </span>
                <time>{formatDate(deployment.createdAt)}</time>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Environment</h2>
            <p>Service가 배포될 사전 등록 환경입니다.</p>
          </div>
        </div>
        <div className={styles.chipList}>
          {environments.map((environment) => (
            <span className={styles.chip} key={environment.id}>
              {environment.name} · {environment.tier}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function CreateProjectForm({
  sites,
  onCreated,
}: Readonly<{
  sites: readonly Site[];
  onCreated: (project: Project) => void;
}>) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [siteIds, setSiteIds] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const project = await createProject({
        key,
        name,
        description: description.trim() || undefined,
        siteIds,
      });
      onCreated(project);
      setKey('');
      setName('');
      setDescription('');
      setSiteIds([]);
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
          <h2>Project 생성</h2>
          <p>Integration API Client와 공유할 Site 범위를 지정합니다.</p>
        </div>
      </div>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Key</span>
            <input required value={key} onChange={(event) => setKey(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>이름</span>
            <input required value={name} onChange={(event) => setName(event.target.value)} />
          </label>
        </div>
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
          {busy ? '생성 중…' : 'Project 생성'}
        </button>
      </form>
    </section>
  );
}

function CreateEnvironmentForm({
  onCreated,
}: Readonly<{ onCreated: (environment: Environment) => void }>) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [tier, setTier] = useState<EnvironmentTier>('production');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const environment = await createEnvironment({ key, name, tier });
      onCreated(environment);
      setKey('');
      setName('');
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
          <h2>Environment 생성</h2>
          <p>Production, Staging 등 배포 대상 환경을 등록합니다.</p>
        </div>
      </div>
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
          <span>Tier</span>
          <select value={tier} onChange={(event) => setTier(event.target.value as EnvironmentTier)}>
            <option value="production">Production</option>
            <option value="staging">Staging</option>
            <option value="development">Development</option>
            <option value="other">Other</option>
          </select>
        </label>
        {error ? <p className={styles.error}>{error}</p> : null}
        <button className={styles.primaryButton} disabled={busy}>
          {busy ? '생성 중…' : 'Environment 생성'}
        </button>
      </form>
    </section>
  );
}

function projectStatusLabel(status: Project['status']) {
  return status === 'active' ? '활성' : status === 'paused' ? '일시정지' : '보관';
}

export function deploymentStatusLabel(status: Deployment['status']) {
  switch (status) {
    case 'queued':
      return '대기';
    case 'running':
      return '진행 중';
    case 'succeeded':
      return '성공';
    case 'failed':
      return '실패';
    case 'cancelled':
      return '취소';
  }
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
}
