import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  AdminPermission,
  type WorkspaceRecord,
  type WorkspaceService,
} from '@atlas/server';

import { AdminCsrfGuard } from '../admin-session/admin-csrf.guard';
import {
  AdminPermissionGuard,
  RequireAdminPermission,
} from '../admin-session/admin-permission.guard';
import { AdminSessionGuard } from '../admin-session/admin-session.guard';
import { AdminWorkspaceGuard } from './admin-workspace.guard';
import {
  requireAdminWorkspace,
  type AdminWorkspaceHttpRequest,
} from './admin-workspace.request';
import { WORKSPACE_SERVICE } from './admin-workspace-site.tokens';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';

@ApiTags('Admin Workspace')
@Controller('admin/v1/workspace')
export class AdminWorkspaceController {
  public constructor(
    @Inject(WORKSPACE_SERVICE)
    private readonly workspaceService: WorkspaceService<unknown>,
  ) {}

  @Get()
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.WORKSPACES_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Returns the default Workspace.' })
  @ApiUnauthorizedResponse({ description: 'Administrator Session is required.' })
  public getWorkspace(
    @Req() request: AdminWorkspaceHttpRequest,
  ): { data: ReturnType<typeof toWorkspaceData> } {
    return { data: toWorkspaceData(requireAdminWorkspace(request)) };
  }

  @Patch()
  @UseGuards(
    AdminSessionGuard,
    AdminWorkspaceGuard,
    AdminCsrfGuard,
    AdminPermissionGuard,
  )
  @RequireAdminPermission(AdminPermission.WORKSPACES_MANAGE)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Updates the default Workspace settings.' })
  public async updateWorkspace(
    @Req() request: AdminWorkspaceHttpRequest,
    @Body() body: UpdateWorkspaceDto,
  ): Promise<{ data: ReturnType<typeof toWorkspaceData> }> {
    const workspace = requireAdminWorkspace(request);
    const updated = await this.workspaceService.updateWorkspace(workspace.id, body);

    return { data: toWorkspaceData(updated) };
  }
}

function toWorkspaceData(workspace: Readonly<WorkspaceRecord>) {
  return {
    id: workspace.id,
    key: workspace.key,
    name: workspace.name,
    timezone: workspace.timezone,
    locale: workspace.locale,
    version: workspace.version,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  };
}
