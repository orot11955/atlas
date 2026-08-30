'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { loadDeployment } from './project-deployment-api';
import type { DeploymentDetail as DeploymentDetailType } from './project-deployment-types';
import { deploymentStatusLabel, formatDate } from './project-manager';
import styles from './project-deployment.module.css';

export function DeploymentDetail({ deploymentId }: Readonly<{ deploymentId: string }>) {
  const [detail, setDetail] = useState<DeploymentDetailType>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void loadDeployment(deploymentId)
      .then(setDetail)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : '조회 실패'));
  }, [deploymentId]);

  if (!detail) {
    return <div className={styles.empty}>{error ?? '배포를 불러오는 중입니다.'}</div>;
  }

  const deployment = detail.deployment;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className="eyebrow">DEPLOYMENT DETAIL</p>
          <h1>{detail.project.name}</h1>
          <p>
            {detail.service.name} → {detail.environment.name}
          </p>
        </div>
        <Link className={styles.secondaryLink} href={`/admin/projects/${detail.project.id}`}>
          Project 보기
        </Link>
      </header>

      <div className={styles.twoColumn}>
        <section className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Deployment</h2>
              <p>원격 실행이 아닌 CI가 전달한 Read Model입니다.</p>
            </div>
            <span className={styles.statusPill} data-status={deployment.status}>
              {deploymentStatusLabel(deployment.status)}
            </span>
          </div>
          <dl className={styles.detailList}>
            <div>
              <dt>Release</dt>
              <dd>{detail.release.version}</dd>
            </div>
            <div>
              <dt>Commit</dt>
              <dd>{detail.release.commitSha}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{deployment.startedAt ? formatDate(deployment.startedAt) : '-'}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>{deployment.completedAt ? formatDate(deployment.completedAt) : '-'}</dd>
            </div>
            {deployment.failureMessage ? (
              <div>
                <dt>실패 원인</dt>
                <dd>{deployment.failureMessage}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Health</h2>
              <p>배포 성공 여부와 독립된 상태입니다.</p>
            </div>
            <span
              className={styles.statusPill}
              data-status={detail.latestHealth?.status ?? 'unknown'}
            >
              {healthLabel(detail.latestHealth?.status)}
            </span>
          </div>
          <dl className={styles.detailList}>
            <div>
              <dt>등록 URL</dt>
              <dd>{detail.serviceEnvironment.healthUrl ?? '미등록'}</dd>
            </div>
            <div>
              <dt>HTTP</dt>
              <dd>{detail.latestHealth?.httpStatus ?? '-'}</dd>
            </div>
            <div>
              <dt>Latency</dt>
              <dd>
                {detail.latestHealth?.latencyMs !== undefined
                  ? `${detail.latestHealth.latencyMs}ms`
                  : '-'}
              </dd>
            </div>
            <div>
              <dt>Checked</dt>
              <dd>{detail.latestHealth ? formatDate(detail.latestHealth.checkedAt) : '-'}</dd>
            </div>
            {detail.latestHealth?.message ? (
              <div>
                <dt>메시지</dt>
                <dd>{detail.latestHealth.message}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      </div>

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Deployment Timeline</h2>
            <p>외부 Event ID가 있으면 중복 Event를 제거합니다.</p>
          </div>
        </div>
        <ol className={styles.timeline}>
          {detail.events.map((event) => (
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
}

function healthLabel(status: 'healthy' | 'unhealthy' | 'unknown' | undefined) {
  return status === 'healthy' ? '정상' : status === 'unhealthy' ? '비정상' : '미확인';
}
