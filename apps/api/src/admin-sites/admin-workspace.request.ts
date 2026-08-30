import { ActorType, requestContext, type WorkspaceRecord } from '@atlas/server';

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

  const current = requestContext.require();
  const principal = request.adminSession;
  requestContext.enter({
    ...current,
    ...(principal
      ? {
          actorType: ActorType.ADMIN,
          actorId: principal.adminAccountId,
          sessionId: principal.sessionId,
        }
      : {}),
    workspaceId: request.adminWorkspace.id,
  });

  return request.adminWorkspace;
}
