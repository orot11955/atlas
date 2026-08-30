'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { loadSites } from '../sites/site-api';
import type { Site } from '../sites/site-types';
import { createMember, loadMembers } from './resource-member-api';
import {
  MEMBERSHIP_STATUS_OPTIONS,
  type Member,
  type SiteMembershipStatus,
} from './resource-member-types';
import styles from './resource-member.module.css';

export function MemberManager() {
  const [members, setMembers] = useState<readonly Member[]>([]);
  const [sites, setSites] = useState<readonly Site[]>([]);
  const [search, setSearch] = useState('');
  const [siteId, setSiteId] = useState('');
  const [membershipStatus, setMembershipStatus] = useState<SiteMembershipStatus | ''>('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    void reload();
  }, []);
  async function reload(
    filters: { search?: string; siteId?: string; membershipStatus?: SiteMembershipStatus } = {},
  ) {
    setError(undefined);
    try {
      const [nextMembers, siteResult] = await Promise.all([
        loadMembers({ limit: 100, ...filters }),
        loadSites({ limit: 100 }),
      ]);
      setMembers(nextMembers);
      setSites(siteResult.items.filter((site) => site.status !== 'archived'));
    } catch (caught) {
      setError(readError(caught));
    }
  }
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void reload({
      search,
      siteId: siteId || undefined,
      membershipStatus: membershipStatus || undefined,
    });
  }
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className="eyebrow">MEMBER DIRECTORY</p>
          <h1>회원</h1>
          <p>하나의 Member를 여러 Site에서 서로 다른 상태로 관리합니다.</p>
        </div>
      </header>
      {error ? <p className={styles.error}>{error}</p> : null}
      <CreateMemberForm
        sites={sites}
        onCreated={(member) => setMembers((current) => [member, ...current])}
      />
      <section className={styles.panel}>
        <form className={styles.toolbar} onSubmit={filter}>
          <label className={styles.field}>
            <span>검색</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Site</span>
            <select value={siteId} onChange={(event) => setSiteId(event.target.value)}>
              <option value="">전체</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Membership</span>
            <select
              value={membershipStatus}
              onChange={(event) =>
                setMembershipStatus(event.target.value as SiteMembershipStatus | '')
              }
            >
              <option value="">전체</option>
              {MEMBERSHIP_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button className={styles.secondaryButton}>조회</button>
        </form>
      </section>
      <section className={styles.list}>
        {members.map((member) => (
          <Link className={styles.tableRow} href={`/admin/members/${member.id}`} key={member.id}>
            <span>
              <strong>{member.displayName}</strong>
              <small>
                {member.email ?? `${member.externalProvider}:${member.externalSubject}`}
              </small>
            </span>
            <span className={styles.pill} data-state={member.status}>
              {member.status}
            </span>
            <span>{member.memberships.length} Site</span>
          </Link>
        ))}
      </section>
      {members.length === 0 ? <div className={styles.empty}>등록된 Member가 없습니다.</div> : null}
    </div>
  );
}

function CreateMemberForm({
  sites,
  onCreated,
}: Readonly<{ sites: readonly Site[]; onCreated: (member: Member) => void }>) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [externalProvider, setExternalProvider] = useState('');
  const [externalSubject, setExternalSubject] = useState('');
  const [siteId, setSiteId] = useState('');
  const [status, setStatus] = useState<SiteMembershipStatus>('pending');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const member = await createMember({
        displayName,
        email: email.trim() || undefined,
        externalProvider: externalProvider.trim() || undefined,
        externalSubject: externalSubject.trim() || undefined,
        memberships: siteId ? [{ siteId, status }] : [],
      });
      onCreated(member);
      setDisplayName('');
      setEmail('');
      setExternalProvider('');
      setExternalSubject('');
      setSiteId('');
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
          <h2>Member 등록</h2>
          <p>Password와 Login은 Phase 12에서 연결합니다.</p>
        </div>
      </div>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>이름</span>
            <input
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Email</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>External Provider</span>
            <input
              value={externalProvider}
              onChange={(event) => setExternalProvider(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>External Subject</span>
            <input
              value={externalSubject}
              onChange={(event) => setExternalSubject(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>초기 Site</span>
            <select value={siteId} onChange={(event) => setSiteId(event.target.value)}>
              <option value="">없음</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>상태</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as SiteMembershipStatus)}
            >
              {MEMBERSHIP_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error ? <p className={styles.error}>{error}</p> : null}
        <button className={styles.primaryButton} disabled={busy}>
          {busy ? '등록 중…' : 'Member 등록'}
        </button>
      </form>
    </section>
  );
}
function readError(error: unknown) {
  return error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
}
