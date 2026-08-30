'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { loadDeployments, loadEnvironments, loadProjects } from './project-deployment-api';
import type {
  Deployment,
  DeploymentStatus,
  Environment,
  Project,
} from './project-deployment-types';
import { deploymentStatusLabel, formatDate } from './project-manager';
import styles from './project-deployment.module.css';

export function DeploymentList({ initialProjectId }: Readonly<{ initialProjectId?: string }>) {
  const [deployments, setDeployments] = useState<readonly Deployment[]>([]);
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [environments, setEnvironments] = useState<readonly Environment[]>([]);
  const [projectId, setProjectId] = useState(initialProjectId ?? '');
  const [environmentId, setEnvironmentId] = useState('');
  const [status, setStatus] = useState<DeploymentStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void loadInitial();
  }, []);

  async function loadInitial() {
    setLoading(true);
    try {
      const [deploymentResult, projectResult, environmentResult] = await Promise.all([
        loadDeployments({ projectId: initialProjectId, limit: 100 }),
        loadProjects(),
        loadEnvironments(),
      ]);
      setDeployments(deploymentResult);
      setProjects(projectResult);
      setEnvironments(environmentResult);
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
      setDeployments(
        await loadDeployments({
          projectId: projectId || undefined,
          environmentId: environmentId || undefined,
          status: status || undefined,
          limit: 100,
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
          <p className="eyebrow">DEPLOYMENT READ MODEL</p>
          <h1>배포</h1>
          <p>CI Callback으로 수집한 배포 상태와 Health 결과를 조회합니다.</p>
        </div>
      </header>

      <section className={styles.panel}>
        <form className={styles.formGrid} onSubmit={filter}>
          <label className={styles.field}>
            <span>Project</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">전체</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Environment</span>
            <select
              value={environmentId}
              onChange={(event) => setEnvironmentId(event.target.value)}
            >
              <option value="">전체</option>
              {environments.map((environment) => (
                <option key={environment.id} value={environment.id}>
                  {environment.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>상태</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as DeploymentStatus | '')}
            >
              <option value="">전체</option>
              <option value="queued">대기</option>
              <option value="running">진행 중</option>
              <option value="succeeded">성공</option>
              <option value="failed">실패</option>
              <option value="cancelled">취소</option>
            </select>
          </label>
          <button className={styles.primaryButton} disabled={loading}>
            조회
          </button>
        </form>
      </section>

      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.panel}>
        {deployments.length === 0 && !loading ? (
          <div className={styles.empty}>조건에 맞는 배포가 없습니다.</div>
        ) : (
          <div className={styles.tableList}>
            {deployments.map((deployment) => {
              const project = projects.find((item) => item.id === deployment.projectId);
              return (
                <Link
                  className={styles.tableRow}
                  href={`/admin/deployments/${deployment.id}`}
                  key={deployment.id}
                >
                  <span>
                    <strong>{project?.name ?? deployment.projectId.slice(0, 8)}</strong>
                    <small>{deployment.externalId ?? deployment.id.slice(0, 12)}</small>
                  </span>
                  <span className={styles.statusPill} data-status={deployment.status}>
                    {deploymentStatusLabel(deployment.status)}
                  </span>
                  <time>{formatDate(deployment.createdAt)}</time>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : '배포 목록을 불러오지 못했습니다.';
}
