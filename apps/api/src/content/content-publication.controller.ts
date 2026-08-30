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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AdminPermission, type ContentPublicationService } from '@atlas/server';

import { AdminCsrfGuard } from '../admin-session/admin-csrf.guard';
import {
  AdminPermissionGuard,
  RequireAdminPermission,
} from '../admin-session/admin-permission.guard';
import { AdminSessionGuard } from '../admin-session/admin-session.guard';
import { AdminWorkspaceGuard } from '../admin-sites/admin-workspace.guard';
import {
  requireAdminWorkspace,
  type AdminWorkspaceHttpRequest,
} from '../admin-sites/admin-workspace.request';
import { CreateContentSiteDto, UpdateContentSiteDto } from './content-publication.dto';
import { toContentPublicationData, toContentSiteData } from './content-publication.presenter';
import { CONTENT_PUBLICATION_SERVICE } from './content.tokens';

interface PassthroughResponse {
  setHeader(name: string, value: string): void;
}

const READ_GUARDS = [AdminSessionGuard, AdminWorkspaceGuard, AdminPermissionGuard] as const;
const WRITE_GUARDS = [
  AdminSessionGuard,
  AdminWorkspaceGuard,
  AdminCsrfGuard,
  AdminPermissionGuard,
] as const;

@ApiTags('Admin Content Publication')
@Controller('admin/v1/contents/:contentId/sites')
export class ContentPublicationController {
  public constructor(
    @Inject(CONTENT_PUBLICATION_SERVICE)
    private readonly publicationService: ContentPublicationService<unknown>,
  ) {}

  @Get()
  @UseGuards(...READ_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Returns Site assignments and active Publication summaries.' })
  public async list(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('contentId', new ParseUUIDPipe({ version: '7' })) contentId: string,
  ) {
    const workspace = requireAdminWorkspace(request);
    const records = await this.publicationService.listContentSites(workspace.id, contentId);
    return { data: records.map(toContentSiteData) };
  }

  @Post()
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({ description: 'Assigns Content to one Site.' })
  public async create(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('contentId', new ParseUUIDPipe({ version: '7' })) contentId: string,
    @Body() body: CreateContentSiteDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const record = await this.publicationService.createContentSite(workspace.id, contentId, body);
    return { data: toContentSiteData(record) };
  }

  @Patch(':contentSiteId')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Updates Site-specific route and presentation overrides.' })
  public async update(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('contentId', new ParseUUIDPipe({ version: '7' })) contentId: string,
    @Param('contentSiteId', new ParseUUIDPipe({ version: '7' })) contentSiteId: string,
    @Body() body: UpdateContentSiteDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const record = await this.publicationService.updateContentSite(
      workspace.id,
      contentId,
      contentSiteId,
      body,
    );
    return { data: toContentSiteData(record) };
  }

  @Post(':contentSiteId/publish')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({
    description: 'Publishes the current READY Revision as an immutable Snapshot.',
  })
  public async publish(
    @Req() request: AdminWorkspaceHttpRequest,
    @Res({ passthrough: true }) response: PassthroughResponse,
    @Param('contentId', new ParseUUIDPipe({ version: '7' })) contentId: string,
    @Param('contentSiteId', new ParseUUIDPipe({ version: '7' })) contentSiteId: string,
  ) {
    const workspace = requireAdminWorkspace(request);
    const result = await this.publicationService.publish(workspace.id, contentId, contentSiteId);
    response.setHeader('Idempotent-Replayed', result.replayed ? 'true' : 'false');
    return { data: toContentPublicationData(result.publication) };
  }

  @Post(':contentSiteId/withdraw')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Withdraws the active Publication without deleting its Snapshot.' })
  public async withdraw(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('contentId', new ParseUUIDPipe({ version: '7' })) contentId: string,
    @Param('contentSiteId', new ParseUUIDPipe({ version: '7' })) contentSiteId: string,
  ) {
    const workspace = requireAdminWorkspace(request);
    const publication = await this.publicationService.withdraw(
      workspace.id,
      contentId,
      contentSiteId,
    );
    return { data: toContentPublicationData(publication) };
  }

  @Get(':contentSiteId/publications')
  @UseGuards(...READ_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Returns immutable Publication history.' })
  public async history(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('contentId', new ParseUUIDPipe({ version: '7' })) contentId: string,
    @Param('contentSiteId', new ParseUUIDPipe({ version: '7' })) contentSiteId: string,
  ) {
    const workspace = requireAdminWorkspace(request);
    const publications = await this.publicationService.listPublications(
      workspace.id,
      contentId,
      contentSiteId,
    );
    return { data: publications.map(toContentPublicationData) };
  }

  @Post(':contentSiteId/publications/:publicationId/rollback')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({
    description: 'Copies a historical Snapshot into a new active Publication.',
  })
  public async rollback(
    @Req() request: AdminWorkspaceHttpRequest,
    @Res({ passthrough: true }) response: PassthroughResponse,
    @Param('contentId', new ParseUUIDPipe({ version: '7' })) contentId: string,
    @Param('contentSiteId', new ParseUUIDPipe({ version: '7' })) contentSiteId: string,
    @Param('publicationId', new ParseUUIDPipe({ version: '7' })) publicationId: string,
  ) {
    const workspace = requireAdminWorkspace(request);
    const result = await this.publicationService.rollback(
      workspace.id,
      contentId,
      contentSiteId,
      publicationId,
    );
    response.setHeader('Idempotent-Replayed', result.replayed ? 'true' : 'false');
    return { data: toContentPublicationData(result.publication) };
  }
}
