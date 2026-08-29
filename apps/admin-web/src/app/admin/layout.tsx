import type { ReactNode } from 'react';

import { AdminShell } from '../../components/admin/admin-shell';
import { requireServerAdminSession } from '../../features/auth/server-session';

export default async function AdminLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const session = await requireServerAdminSession();

  return <AdminShell session={session}>{children}</AdminShell>;
}
