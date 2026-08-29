import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';

import type { WorkspaceService } from '@atlas/server';

import type { AdminWorkspaceHttpRequest } from './admin-workspace.request';
import { WORKSPACE_SERVICE } from './admin-workspace-site.tokens';

@Injectable()
export class AdminWorkspaceGuard implements CanActivate {
  public constructor(
    @Inject(WORKSPACE_SERVICE)
    private readonly workspaceService: WorkspaceService<unknown>,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminWorkspaceHttpRequest>();
    const workspace = await this.workspaceService.getDefaultWorkspace();

    request.adminWorkspace = workspace;
    this.workspaceService.enterRequestContext(workspace.id);
    return true;
  }
}
