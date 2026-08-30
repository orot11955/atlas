'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const activeItems = [
  { href: '/admin', label: 'Dashboard', exact: true },
  { href: '/admin/sites', label: 'Site', exact: false },
  { href: '/admin/api-clients', label: 'API Client', exact: false },
  { href: '/admin/projects', label: '프로젝트', exact: false },
  { href: '/admin/deployments', label: '배포', exact: false },
  { href: '/admin/resources', label: '자료실', exact: false },
  { href: '/admin/members', label: '회원', exact: false },
  { href: '/admin/security/sessions', label: '활성 Session', exact: false },
] as const;

const plannedItems = ['콘텐츠'] as const;

export function AdminNavigation() {
  const pathname = usePathname();
  return (
    <nav className="admin-navigation" aria-label="관리자 메뉴">
      <p className="nav-section-label">운영</p>
      <ul className="nav-list">
        {activeItems.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return <li key={item.href}><Link className={active ? 'nav-link active' : 'nav-link'} href={item.href}><span className="nav-dot" aria-hidden="true" />{item.label}</Link></li>;
        })}
      </ul>
      <p className="nav-section-label planned-label">구현 예정</p>
      <ul className="nav-list planned-nav" aria-label="구현 예정 메뉴">
        {plannedItems.map((item) => <li className="nav-link disabled" key={item} aria-disabled="true"><span className="nav-dot" aria-hidden="true" />{item}</li>)}
      </ul>
    </nav>
  );
}
