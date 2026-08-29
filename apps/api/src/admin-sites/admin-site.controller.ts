import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { AdminPermission, SiteStatus, type SiteRecord, type SiteService } from '@atlas/server';

import { AdminCsrfGuard } from '../admin-session/admin-csrf.guard';
import {
  AdminPermissionGuard,
  RequireAdminPermission,
} from '../admin-session/admin-permission.guard';
import { AdminSessionGuard } from '../admin-session/admin-session.guard';
import { AdminWorkspaceGuard } from './admin-workspace.guard';
import { requireAdminWorkspace, type AdminWorkspaceHttpRequest } from './admin-workspace.request';
import { SITE_SERVICE } from './admin-workspace-site.tokens';
import { CreateSiteDto } from './dto/create-site.dto';
import { SiteListQueryDto } from './dto/site-list-query.dto';
import { SiteStatusTransitionDto } from './dto/site-status-transition.dto';
import { UpdateSiteDto } from './dto/update-site.dto';

@ApiTags('Admin Sites')
@Controller('admin/v1/sites')
export class AdminSiteController {
  public constructor(
    @Inject(SITE_SERVICE)
    private readonly siteService: SiteService<unknown>,
  ) {}

  @Get()
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.SITES_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Returns a cursor-paginated Site list.' })
  @ApiUnauthorizedResponse({ description: 'Administrator Session is required.' })
  public async listSites(
    @Req() request: AdminWorkspaceHttpRequest,
    @Query() query: SiteListQueryDto,
  ): Promise<{
    data: {
      items: readonly ReturnType<typeof toSiteData>[];
      pageInfo: { nextCursor?: string };
    };
  }> {
    const workspace = requireAdminWorkspace(request);
    const result = await this.siteService.listSites(workspace.id, {
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
      status: query.status,
      type: query.type,
      search: query.search,
    });

    return {
      data: {
        items: result.items.map(toSiteData),
        pageInfo: {
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        },
      },
    };
  }

  @Post()
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({ description: 'Creates a draft Site.' })
  public async createSite(
    @Req() request: AdminWorkspaceHttpRequest,
    @Body() body: CreateSiteDto,
  ): Promise<{ data: ReturnType<typeof toSiteData> }> {
    const workspace = requireAdminWorkspace(request);
    const site = await this.siteService.createSite(workspace.id, body);

    return { data: toSiteData(site) };
  }

  @Get(':siteId')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.SITES_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Returns a Site in the default Workspace.' })
  public async getSite(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('siteId', new ParseUUIDPipe({ version: '7' })) siteId: string,
  ): Promise<{ data: ReturnType<typeof toSiteData> }> {
    const workspace = requireAdminWorkspace(request);
    const site = await this.siteService.getSite(workspace.id, siteId);

    return { data: toSiteData(site) };
  }

  @Patch(':siteId')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Updates mutable Site settings.' })
  public async updateSite(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('siteId', new ParseUUIDPipe({ version: '7' })) siteId: string,
    @Body() body: UpdateSiteDto,
  ): Promise<{ data: ReturnType<typeof toSiteData> }> {
    const workspace = requireAdminWorkspace(request);
    const site = await this.siteService.updateSite(workspace.id, siteId, body);

    return { data: toSiteData(site) };
  }

  @Post(':siteId/activate')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @Header('Cache-Control', 'no-store')
  public activateSite(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('siteId', new ParseUUIDPipe({ version: '7' })) siteId: string,
    @Body() body: SiteStatusTransitionDto,
  ) {
    return this.transition(request, siteId, SiteStatus.ACTIVE, body.version);
  }

  @Post(':siteId/maintenance')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @Header('Cache-Control', 'no-store')
  public putSiteInMaintenance(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('siteId', new ParseUUIDPipe({ version: '7' })) siteId: string,
    @Body() body: SiteStatusTransitionDto,
  ) {
    return this.transition(request, siteId, SiteStatus.MAINTENANCE, body.version);
  }

  @Post(':siteId/disable')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @Header('Cache-Control', 'no-store')
  public disableSite(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('siteId', new ParseUUIDPipe({ version: '7' })) siteId: string,
    @Body() body: SiteStatusTransitionDto,
  ) {
    return this.transition(request, siteId, SiteStatus.DISABLED, body.version);
  }

  @Post(':siteId/archive')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @Header('Cache-Control', 'no-store')
  public archiveSite(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('siteId', new ParseUUIDPipe({ version: '7' })) siteId: string,
    @Body() body: SiteStatusTransitionDto,
  ) {
    return this.transition(request, siteId, SiteStatus.ARCHIVED, body.version);
  }

  private async transition(
    request: AdminWorkspaceHttpRequest,
    siteId: string,
    status: SiteStatus,
    version: number,
  ): Promise<{ data: ReturnType<typeof toSiteData> }> {
    const workspace = requireAdminWorkspace(request);
    const site = await this.siteService.changeStatus(workspace.id, siteId, status, version);

    return { data: toSiteData(site) };
  }
}

function toSiteData(site: Readonly<SiteRecord>) {
  return {
    id: site.id,
    workspaceId: site.workspaceId,
    key: site.key,
    name: site.name,
    ...(site.description ? { description: site.description } : {}),
    type: site.type,
    status: site.status,
    timezone: site.timezone,
    locale: site.locale,
    version: site.version,
    ...(site.canonicalDomain
      ? {
          canonicalDomain: {
            id: site.canonicalDomain.id,
            hostname: site.canonicalDomain.hostname,
            verificationStatus: site.canonicalDomain.verificationStatus,
            ...(site.canonicalDomain.verifiedAt
              ? { verifiedAt: site.canonicalDomain.verifiedAt.toISOString() }
              : {}),
          },
        }
      : {}),
    ...(site.archivedAt ? { archivedAt: site.archivedAt.toISOString() } : {}),
    createdAt: site.createdAt.toISOString(),
    updatedAt: site.updatedAt.toISOString(),
  };
}
