'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { loadProjects } from '../project-deployment/project-deployment-api';
import type { Project } from '../project-deployment/project-deployment-types';
import {
  archiveResource,
  loadResource,
  loadResourceCollections,
  updateResource,
} from './resource-member-api';
import {
  RESOURCE_TYPE_OPTIONS,
  type Resource,
  type ResourceCollection,
  type ResourceType,
} from './resource-member-types';
import styles from './resource-member.module.css';

export function ResourceDetail({ resourceId }: Readonly<{ resourceId: string }>) {
  const [resource, setResource] = useState<Resource>();
  const [collections, setCollections] = useState<readonly ResourceCollection[]>([]);
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [form, setForm] = useState({
    type: 'note' as ResourceType,
    title: '',
    summary: '',
    bodyMarkdown: '',
    sourceUrl: '',
    collectionId: '',
    tags: '',
    projectIds: [] as string[],
    sensitivity: 'normal' as 'normal' | 'sensitive',
    secretReference: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    Promise.all([loadResource(resourceId), loadResourceCollections(), loadProjects()])
      .then(([next, nextCollections, nextProjects]) => {
        setResource(next);
        setCollections(nextCollections);
        setProjects(nextProjects);
        setForm({
          type: next.type,
          title: next.title,
          summary: next.summary ?? '',
          bodyMarkdown: next.bodyMarkdown ?? '',
          sourceUrl: next.sourceUrl ?? '',
          collectionId: next.collectionId ?? '',
          tags: next.tags.join(', '),
          projectIds: [...next.projectIds],
          sensitivity: next.sensitivity,
          secretReference: next.secretReference ?? '',
        });
      })
      .catch((caught) => setError(readError(caught)));
  }, [resourceId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resource) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const updated = await updateResource(resource.id, {
        version: resource.version,
        type: form.type,
        title: form.title,
        summary: form.summary.trim() || undefined,
        bodyMarkdown: form.bodyMarkdown.trim() || undefined,
        sourceUrl: form.sourceUrl.trim() || undefined,
        collectionId: form.collectionId || undefined,
        visibility: resource.visibility,
        sensitivity: form.sensitivity,
        secretReference: form.secretReference.trim() || undefined,
        tags: form.tags
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        projectIds: form.projectIds,
      });
      setResource(updated);
      setMessage('Resource를 저장했습니다.');
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!resource) return;
    setBusy(true);
    setError(undefined);
    try {
      setResource(await archiveResource(resource.id, resource.version));
      setMessage('Resource를 보관했습니다.');
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!resource)
    return <div className={styles.empty}>{error ?? 'Resource를 불러오는 중입니다…'}</div>;
  const archived = resource.status === 'archived';
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className="eyebrow">RESOURCE · {resource.type}</p>
          <h1>{resource.title}</h1>
          <p>
            Version {resource.version} · {resource.status}
          </p>
        </div>
        <Link className={styles.secondaryLink} href="/admin/resources">
          목록으로
        </Link>
      </header>
      <section className={styles.panel}>
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>유형</span>
              <select
                disabled={archived}
                value={form.type}
                onChange={(event) => setForm({ ...form, type: event.target.value as ResourceType })}
              >
                {RESOURCE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Collection</span>
              <select
                disabled={archived}
                value={form.collectionId}
                onChange={(event) => setForm({ ...form, collectionId: event.target.value })}
              >
                <option value="">없음</option>
                {collections
                  .filter((item) => item.status === 'active')
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>민감도</span>
              <select
                disabled={archived}
                value={form.sensitivity}
                onChange={(event) =>
                  setForm({ ...form, sensitivity: event.target.value as 'normal' | 'sensitive' })
                }
              >
                <option value="normal">Normal</option>
                <option value="sensitive">Sensitive</option>
              </select>
            </label>
            <label className={styles.field}>
              <span>제목</span>
              <input
                disabled={archived}
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <label className={`${styles.field} ${styles.fullWidth}`}>
              <span>요약</span>
              <input
                disabled={archived}
                value={form.summary}
                onChange={(event) => setForm({ ...form, summary: event.target.value })}
              />
            </label>
            <label className={`${styles.field} ${styles.fullWidth}`}>
              <span>Markdown</span>
              <textarea
                disabled={archived}
                value={form.bodyMarkdown}
                onChange={(event) => setForm({ ...form, bodyMarkdown: event.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span>Source URL</span>
              <input
                disabled={archived}
                value={form.sourceUrl}
                onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span>Tags</span>
              <input
                disabled={archived}
                value={form.tags}
                onChange={(event) => setForm({ ...form, tags: event.target.value })}
              />
            </label>
            <label className={`${styles.field} ${styles.fullWidth}`}>
              <span>Secret Reference</span>
              <input
                disabled={archived}
                value={form.secretReference}
                onChange={(event) => setForm({ ...form, secretReference: event.target.value })}
              />
            </label>
          </div>
          <fieldset className={styles.fieldset}>
            <legend>Project Relation</legend>
            <div className={styles.checkboxGrid}>
              {projects.map((project) => (
                <label key={project.id}>
                  <input
                    disabled={archived}
                    type="checkbox"
                    checked={form.projectIds.includes(project.id)}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        projectIds: event.target.checked
                          ? [...form.projectIds, project.id]
                          : form.projectIds.filter((id) => id !== project.id),
                      })
                    }
                  />
                  {project.name}
                </label>
              ))}
            </div>
          </fieldset>
          {!archived ? (
            <div className={styles.actions}>
              <button className={styles.primaryButton} disabled={busy}>
                저장
              </button>
              <button
                className={styles.dangerButton}
                disabled={busy}
                type="button"
                onClick={archive}
              >
                보관
              </button>
            </div>
          ) : null}
        </form>
      </section>
      {message ? <p className={styles.message}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}
function readError(error: unknown) {
  return error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
}
