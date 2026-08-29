import type { WorkspaceRecord } from '@atlas/server';

import type { AdminSessionHttpRequest } from '../admin-session/admin-session.request';

export interface AdminWorkspaceHttpRequest extends AdminSessionHttpRequest {
  adminWorkspace?: Readonly<WorkspaceRecord>;
}

export function requireAdminWorkspace(
  request: AdminWorkspaceHttpRequest,
): Readonly<WorkspaceRecord> {
  if (!request.adminWorkspace) {
    throw new Error('Administrator Workspace context is not available.');
  }

  return request.adminWorkspace;
}
