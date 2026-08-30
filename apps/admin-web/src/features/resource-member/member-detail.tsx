'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { loadSites } from '../sites/site-api';
import type { Site } from '../sites/site-types';
import {
  addMemberNote,
  archiveMember,
  changeMembershipStatus,
  loadMember,
  updateMember,
} from './resource-member-api';
import {
  MEMBERSHIP_STATUS_OPTIONS,
  type Member,
  type SiteMembershipStatus,
} from './resource-member-types';
import styles from './resource-member.module.css';

export function MemberDetail({ memberId }: Readonly<{ memberId: string }>) {
  const [member, setMember] = useState<Member>();
  const [sites, setSites] = useState<readonly Site[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  useEffect(() => {
    Promise.all([loadMember(memberId), loadSites({ limit: 100 })])
      .then(([next, siteResult]) => {
        setMember(next);
        setSites(siteResult.items);
        setDisplayName(next.displayName);
        setEmail(next.email ?? '');
      })
      .catch((caught) => setError(readError(caught)));
  }, [memberId]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!member) return;
    setBusy(true);
    try {
      const updated = await updateMember(member.id, {
        version: member.version,
        displayName,
        email: email.trim() || undefined,
      });
      setMember(updated);
      setMessage('Member를 저장했습니다.');
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setBusy(false);
    }
  }
  async function status(siteId: string, nextStatus: SiteMembershipStatus, version: number) {
    if (!member) return;
    setBusy(true);
    try {
      const updated = await changeMembershipStatus(member.id, siteId, nextStatus, version);
      setMember({
        ...member,
        memberships: member.memberships.map((item) => (item.siteId === siteId ? updated : item)),
      });
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setBusy(false);
    }
  }
  async function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!member) return;
    setBusy(true);
    try {
      const created = await addMemberNote(member.id, note);
      setMember({ ...member, notes: [created, ...member.notes] });
      setNote('');
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    if (!member) return;
    setBusy(true);
    try {
      setMember(await archiveMember(member.id, member.version));
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setBusy(false);
    }
  }
  if (!member) return <div className={styles.empty}>{error ?? 'Member를 불러오는 중입니다…'}</div>;
  const archived = member.status === 'archived';
  const siteById = new Map(sites.map((site) => [site.id, site]));
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className="eyebrow">MEMBER DIRECTORY</p>
          <h1>{member.displayName}</h1>
          <p>{member.email ?? `${member.externalProvider}:${member.externalSubject}`}</p>
        </div>
        <Link className={styles.secondaryLink} href="/admin/members">
          목록으로
        </Link>
      </header>
      <section className={styles.panel}>
        <form className={styles.form} onSubmit={save}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>이름</span>
              <input
                disabled={archived}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>Email</span>
              <input
                disabled={archived}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          </div>
          {!archived ? (
            <div className={styles.actions}>
              <button className={styles.primaryButton} disabled={busy}>
                저장
              </button>
              <button
                className={styles.dangerButton}
                type="button"
                disabled={busy}
                onClick={archive}
              >
                보관
              </button>
            </div>
          ) : null}
        </form>
      </section>
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Site Membership</h2>
            <p>Site별 상태는 서로 독립적입니다.</p>
          </div>
        </div>
        <div className={styles.list}>
          {member.memberships.map((membership) => (
            <div className={styles.tableRow} key={membership.siteId}>
              <span>
                <strong>{siteById.get(membership.siteId)?.name ?? membership.siteId}</strong>
                <small>Version {membership.version}</small>
              </span>
              <span className={styles.pill} data-state={membership.status}>
                {membership.status}
              </span>
              <select
                disabled={busy || archived}
                value={membership.status}
                onChange={(event) =>
                  status(
                    membership.siteId,
                    event.target.value as SiteMembershipStatus,
                    membership.version,
                  )
                }
              >
                {MEMBERSHIP_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>관리자 Note</h2>
            <p>Credential 원문은 저장할 수 없습니다.</p>
          </div>
        </div>
        {!archived ? (
          <form className={styles.form} onSubmit={submitNote}>
            <label className={styles.field}>
              <span>Note</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            <button className={styles.primaryButton} disabled={busy || !note.trim()}>
              Note 추가
            </button>
          </form>
        ) : null}
        <ul className={styles.timeline}>
          {member.notes.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.body}</strong>
                <p>{new Date(item.createdAt).toLocaleString('ko-KR')}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      {message ? <p className={styles.message}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}
function readError(error: unknown) {
  return error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
}
