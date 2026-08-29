'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { loadSites } from './site-api';
import type { Site } from './site-types';
import styles from './sites.module.css';

export function SiteSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const [sites, setSites] = useState<readonly Site[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    loadSites({ limit: 100 })
      .then((result) => {
        if (active) {
          setSites(result.items.filter((site) => site.status !== 'archived'));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setLoaded(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const selected = readSelectedSiteId(pathname);

  if (loaded && sites.length === 0) {
    return (
      <Link className={styles.switcherEmpty} href="/admin/sites/new">
        첫 Site 등록
      </Link>
    );
  }

  return (
    <div className={styles.switcher}>
      <label htmlFor="atlas-site-switcher">Site</label>
      <select
        id="atlas-site-switcher"
        value={selected ?? ''}
        onChange={(event) => {
          const siteId = event.target.value;
          router.push(siteId ? `/admin/sites/${siteId}` : '/admin/sites');
        }}
      >
        <option value="">전체 Site</option>
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name} · {site.status}
          </option>
        ))}
      </select>
    </div>
  );
}

function readSelectedSiteId(pathname: string): string | undefined {
  const match = /^\/admin\/sites\/([0-9a-f-]{36})(?:\/|$)/u.exec(pathname);
  return match?.[1];
}
