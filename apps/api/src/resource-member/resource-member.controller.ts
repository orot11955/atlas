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
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AdminPermission, type ResourceMemberService } from '@atlas/server';

import { AdminCsrfGuard } from '../admin-session/admin-csrf.guard';
import {
  AdminPermissionGuard,
  RequireAdminPermission,
} from '../admin-session/admin-permission.guard';
import {
  AdminSessionGuard,
  requireAdminSessionPrincipal,
} from '../admin-session/admin-session.guard';
import { AdminWorkspaceGuard } from '../admin-sites/admin-workspace.guard';
import {
  requireAdminWorkspace,
  type AdminWorkspaceHttpRequest,
} from '../admin-sites/admin-workspace.request';
import {
  CreateMemberDto,
  CreateResourceCollectionDto,
  CreateResourceDto,
  MemberListQueryDto,
  MemberNoteDto,
  MembershipStatusDto,
  ResourceListQueryDto,
  UpdateMemberDto,
  UpdateResourceCollectionDto,
  UpdateResourceDto,
  VersionDto,
} from './dto/resource-member.dto';
import {
  toCollectionData,
  toMemberData,
  toMemberNoteData,
  toMembershipData,
  toResourceData,
} from './resource-member.presenter';
import { RESOURCE_MEMBER_SERVICE } from './resource-member.tokens';

const READ_GUARDS = [AdminSessionGuard, AdminWorkspaceGuard, AdminPermissionGuard];
const WRITE_GUARDS = [AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard];

@ApiTags('Admin Resources and Members')
@Controller('admin/v1')
export class ResourceMemberController {
  public constructor(
    @Inject(RESOURCE_MEMBER_SERVICE)
    private readonly service: ResourceMemberService<unknown>,
  ) {}

  @Get('resource-collections')
  @UseGuards(...READ_GUARDS)
  @RequireAdminPermission(AdminPermission.RESOURCES_READ)
  @Header('Cache-Control', 'no-store')
  public async listCollections(@Req() request: AdminWorkspaceHttpRequest) {
    const workspace = requireAdminWorkspace(request);
    const records = await this.service.listCollections(workspace.id);
    return { data: records.map(toCollectionData) };
  }

  @Post('resource-collections')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.RESOURCES_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Creates a Resource Collection.' })
  public async createCollection(
    @Req() request: AdminWorkspaceHttpRequest,
    @Body() body: CreateResourceCollectionDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    return { data: toCollectionData(await this.service.createCollection(workspace.id, body)) };
  }

  @Patch('resource-collections/:collectionId')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.RESOURCES_MANAGE)
  public async updateCollection(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('collectionId', new ParseUUIDPipe()) collectionId: string,
    @Body() body: UpdateResourceCollectionDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    return {
      data: toCollectionData(await this.service.updateCollection(workspace.id, collectionId, body)),
    };
  }

  @Post('resource-collections/:collectionId/archive')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.RESOURCES_MANAGE)
  @HttpCode(HttpStatus.OK)
  public async archiveCollection(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('collectionId', new ParseUUIDPipe()) collectionId: string,
    @Body() body: VersionDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    return {
      data: toCollectionData(
        await this.service.archiveCollection(workspace.id, collectionId, body.version),
      ),
    };
  }

  @Get('resources')
  @UseGuards(...READ_GUARDS)
  @RequireAdminPermission(AdminPermission.RESOURCES_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Returns Workspace-scoped Resources.' })
  public async listResources(
    @Req() request: AdminWorkspaceHttpRequest,
    @Query() query: ResourceListQueryDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const records = await this.service.listResources(workspace.id, query);
    return { data: records.map(toResourceData) };
  }

  @Post('resources')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.RESOURCES_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  public async createResource(
    @Req() request: AdminWorkspaceHttpRequest,
    @Body() body: CreateResourceDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    return { data: toResourceData(await this.service.createResource(workspace.id, body)) };
  }

  @Get('resources/:resourceId')
  @UseGuards(...READ_GUARDS)
  @RequireAdminPermission(AdminPermission.RESOURCES_READ)
  @Header('Cache-Control', 'no-store')
  public async getResource(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('resourceId', new ParseUUIDPipe()) resourceId: string,
  ) {
    const workspace = requireAdminWorkspace(request);
    return { data: toResourceData(await this.service.getResource(workspace.id, resourceId)) };
  }

  @Patch('resources/:resourceId')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.RESOURCES_MANAGE)
  public async updateResource(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('resourceId', new ParseUUIDPipe()) resourceId: string,
    @Body() body: UpdateResourceDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    return {
      data: toResourceData(await this.service.updateResource(workspace.id, resourceId, body)),
    };
  }

  @Post('resources/:resourceId/archive')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.RESOURCES_MANAGE)
  @HttpCode(HttpStatus.OK)
  public async archiveResource(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('resourceId', new ParseUUIDPipe()) resourceId: string,
    @Body() body: VersionDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    return {
      data: toResourceData(
        await this.service.archiveResource(workspace.id, resourceId, body.version),
      ),
    };
  }

  @Get('members')
  @UseGuards(...READ_GUARDS)
  @RequireAdminPermission(AdminPermission.MEMBERS_READ)
  @Header('Cache-Control', 'no-store')
  public async listMembers(
    @Req() request: AdminWorkspaceHttpRequest,
    @Query() query: MemberListQueryDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const records = await this.service.listMembers(workspace.id, query);
    return { data: records.map(toMemberData) };
  }

  @Post('members')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.MEMBERS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  public async createMember(
    @Req() request: AdminWorkspaceHttpRequest,
    @Body() body: CreateMemberDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    return { data: toMemberData(await this.service.createMember(workspace.id, body)) };
  }

  @Get('members/:memberId')
  @UseGuards(...READ_GUARDS)
  @RequireAdminPermission(AdminPermission.MEMBERS_READ)
  @Header('Cache-Control', 'no-store')
  public async getMember(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
  ) {
    const workspace = requireAdminWorkspace(request);
    return { data: toMemberData(await this.service.getMember(workspace.id, memberId)) };
  }

  @Patch('members/:memberId')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.MEMBERS_MANAGE)
  public async updateMember(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Body() body: UpdateMemberDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    return {
      data: toMemberData(await this.service.updateMember(workspace.id, memberId, body)),
    };
  }

  @Post('members/:memberId/archive')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.MEMBERS_MANAGE)
  @HttpCode(HttpStatus.OK)
  public async archiveMember(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Body() body: VersionDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    return {
      data: toMemberData(await this.service.archiveMember(workspace.id, memberId, body.version)),
    };
  }

  @Post('members/:memberId/sites/:siteId/status')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.MEMBERS_MANAGE)
  @HttpCode(HttpStatus.OK)
  public async changeMembershipStatus(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Param('siteId', new ParseUUIDPipe()) siteId: string,
    @Body() body: MembershipStatusDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    return {
      data: toMembershipData(
        await this.service.changeMembershipStatus(
          workspace.id,
          memberId,
          siteId,
          body.status,
          body.version,
        ),
      ),
    };
  }

  @Post('members/:memberId/notes')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.MEMBERS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  public async addMemberNote(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Body() body: MemberNoteDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    return {
      data: toMemberNoteData(
        await this.service.addMemberNote(
          workspace.id,
          memberId,
          body.body,
          requireAdminSessionPrincipal(request).adminAccountId,
        ),
      ),
    };
  }
}
