'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { loadProjects } from '../project-deployment/project-deployment-api';
import type { Project } from '../project-deployment/project-deployment-types';
import {
  createResource,
  createResourceCollection,
  loadResourceCollections,
  loadResources,
} from './resource-member-api';
import {
  RESOURCE_TYPE_OPTIONS,
  type Resource,
  type ResourceCollection,
  type ResourceType,
} from './resource-member-types';
import styles from './resource-member.module.css';

export function ResourceManager() {
  const [collections, setCollections] = useState<readonly ResourceCollection[]>([]);
  const [resources, setResources] = useState<readonly Resource[]>([]);
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<ResourceType | ''>('');
  const [tag, setTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void reload();
  }, []);

  async function reload(filters: { search?: string; type?: ResourceType; tag?: string } = {}) {
    setLoading(true);
    setError(undefined);
    try {
      const [nextCollections, nextResources, nextProjects] = await Promise.all([
        loadResourceCollections(),
        loadResources({ limit: 100, ...filters }),
        loadProjects(),
      ]);
      setCollections(nextCollections);
      setResources(nextResources);
      setProjects(nextProjects);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setLoading(false);
    }
  }

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void reload({ search, type: type || undefined, tag });
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className="eyebrow">PERSONAL RESOURCE LIBRARY</p>
          <h1>자료실</h1>
          <p>Markdown 문서, Link와 Project 관련 자료를 Workspace 안에서 관리합니다.</p>
        </div>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.twoColumn}>
        <CollectionForm
          collections={collections}
          onCreated={(collection) => setCollections((current) => [...current, collection])}
        />
        <ResourceForm
          collections={collections}
          projects={projects}
          onCreated={(resource) => setResources((current) => [resource, ...current])}
        />
      </div>

      <section className={styles.panel}>
        <form className={styles.toolbar} onSubmit={filter}>
          <label className={styles.field}>
            <span>검색</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>유형</span>
            <select value={type} onChange={(event) => setType(event.target.value as ResourceType | '')}>
              <option value="">전체</option>
              {RESOURCE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Tag</span>
            <input value={tag} onChange={(event) => setTag(event.target.value)} />
          </label>
          <button className={styles.secondaryButton} disabled={loading}>조회</button>
        </form>
      </section>

      {resources.length === 0 && !loading ? (
        <div className={styles.empty}>등록된 Resource가 없습니다.</div>
      ) : (
        <section className={styles.cardGrid}>
          {resources.map((resource) => (
            <article className={styles.card} key={resource.id}>
              <div className={styles.cardHeader}>
                <span className={styles.pill} data-state={resource.sensitivity}>{resource.type}</span>
                <span className={styles.pill} data-state={resource.status}>{resource.status}</span>
              </div>
              <h3>{resource.title}</h3>
              <p>{resource.summary ?? resource.sourceUrl ?? '요약 없음'}</p>
              <div className={styles.tagList}>
                {resource.tags.map((value) => <span className={styles.tag} key={value}>{value}</span>)}
              </div>
              <Link className={styles.secondaryLink} href={`/admin/resources/${resource.id}`}>상세 관리</Link>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function CollectionForm({ collections, onCreated }: Readonly<{
  collections: readonly ResourceCollection[];
  onCreated: (collection: ResourceCollection) => void;
}>) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(undefined);
    try {
      const collection = await createResourceCollection({ name, parentId: parentId || undefined });
      onCreated(collection); setName(''); setParentId('');
    } catch (caught) { setError(readError(caught)); } finally { setBusy(false); }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}><div><h2>Collection</h2><p>자료 분류를 만듭니다.</p></div></div>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}><span>이름</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className={styles.field}><span>상위 Collection</span><select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">없음</option>{collections.filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {error ? <p className={styles.error}>{error}</p> : null}
        <button className={styles.primaryButton} disabled={busy}>{busy ? '생성 중…' : 'Collection 생성'}</button>
      </form>
    </section>
  );
}

function ResourceForm({ collections, projects, onCreated }: Readonly<{
  collections: readonly ResourceCollection[];
  projects: readonly Project[];
  onCreated: (resource: Resource) => void;
}>) {
  const [type, setType] = useState<ResourceType>('note');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [bodyMarkdown, setBodyMarkdown] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [tags, setTags] = useState('');
  const [projectIds, setProjectIds] = useState<readonly string[]>([]);
  const [sensitivity, setSensitivity] = useState<'normal' | 'sensitive'>('normal');
  const [secretReference, setSecretReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(undefined);
    try {
      const resource = await createResource({
        type, title, summary: summary.trim() || undefined,
        bodyMarkdown: bodyMarkdown.trim() || undefined,
        sourceUrl: sourceUrl.trim() || undefined,
        collectionId: collectionId || undefined,
        visibility: 'private', sensitivity,
        secretReference: secretReference.trim() || undefined,
        tags: tags.split(',').map((value) => value.trim()).filter(Boolean), projectIds,
      });
      onCreated(resource); setTitle(''); setSummary(''); setBodyMarkdown(''); setSourceUrl(''); setTags(''); setProjectIds([]); setSecretReference('');
    } catch (caught) { setError(readError(caught)); } finally { setBusy(false); }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}><div><h2>Resource 등록</h2><p>Secret 원문은 차단되며 secret:// 참조만 저장합니다.</p></div></div>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.formGrid}>
          <label className={styles.field}><span>유형</span><select value={type} onChange={(event) => setType(event.target.value as ResourceType)}>{RESOURCE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className={styles.field}><span>Collection</span><select value={collectionId} onChange={(event) => setCollectionId(event.target.value)}><option value="">없음</option>{collections.filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className={styles.field}><span>민감도</span><select value={sensitivity} onChange={(event) => setSensitivity(event.target.value as 'normal' | 'sensitive')}><option value="normal">Normal</option><option value="sensitive">Sensitive</option></select></label>
          <label className={styles.field}><span>제목</span><input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className={`${styles.field} ${styles.fullWidth}`}><span>요약</span><input value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
          <label className={`${styles.field} ${styles.fullWidth}`}><span>Markdown</span><textarea value={bodyMarkdown} onChange={(event) => setBodyMarkdown(event.target.value)} /></label>
          <label className={styles.field}><span>Source URL</span><input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /></label>
          <label className={styles.field}><span>Tags (쉼표)</span><input value={tags} onChange={(event) => setTags(event.target.value)} /></label>
          <label className={`${styles.field} ${styles.fullWidth}`}><span>Secret Reference</span><input placeholder="secret://atlas/project/key" value={secretReference} onChange={(event) => setSecretReference(event.target.value)} /></label>
        </div>
        <fieldset className={styles.fieldset}><legend>Project Relation</legend><div className={styles.checkboxGrid}>{projects.map((project) => <label key={project.id}><input type="checkbox" checked={projectIds.includes(project.id)} onChange={(event) => setProjectIds((current) => event.target.checked ? [...current, project.id] : current.filter((id) => id !== project.id))} />{project.name}</label>)}</div></fieldset>
        {error ? <p className={styles.error}>{error}</p> : null}
        <button className={styles.primaryButton} disabled={busy}>{busy ? '저장 중…' : 'Resource 등록'}</button>
      </form>
    </section>
  );
}

function readError(error: unknown) { return error instanceof Error ? error.message : '요청을 처리하지 못했습니다.'; }
