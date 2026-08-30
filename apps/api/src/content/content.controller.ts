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

import {
  AdminPermission,
  type ContentRecord,
  type ContentRevisionRecord,
  type ContentService,
} from '@atlas/server';

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
import {
  ArchiveContentDto,
  ContentListQueryDto,
  CreateContentDto,
  CreateContentRevisionDto,
  PreviewContentDto,
  RestoreContentRevisionDto,
  SaveContentDraftDto,
} from './content.dto';
import { CONTENT_SERVICE } from './content.tokens';

const READ_GUARDS = [
  AdminSessionGuard,
  AdminWorkspaceGuard,
  AdminPermissionGuard,
] as const;
const WRITE_GUARDS = [
  AdminSessionGuard,
  AdminWorkspaceGuard,
  AdminCsrfGuard,
  AdminPermissionGuard,
] as const;

@ApiTags('Admin Content')
@Controller('admin/v1/contents')
export class ContentController {
  public constructor(
    @Inject(CONTENT_SERVICE)
    private readonly contentService: ContentService<unknown>,
  ) {}

  @Get()
  @UseGuards(...READ_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Returns Workspace Content and Draft summaries.' })
  @ApiUnauthorizedResponse({ description: 'Administrator Session is required.' })
  public async list(
    @Req() request: AdminWorkspaceHttpRequest,
    @Query() query: ContentListQueryDto,
  ): Promise<{
    data: {
      items: readonly ReturnType<typeof toContentData>[];
      pageInfo: { nextCursor?: string };
    };
  }> {
    const workspace = requireAdminWorkspace(request);
    const result = await this.contentService.listContents(workspace.id, {
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
      status: query.status,
      type: query.type,
      search: query.search,
    });

    return {
      data: {
        items: result.items.map(toContentData),
        pageInfo: {
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        },
      },
    };
  }

  @Post()
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({ description: 'Creates Content and its mutable Draft.' })
  public async create(
    @Req() request: AdminWorkspaceHttpRequest,
    @Body() body: CreateContentDto,
  ): Promise<{ data: ReturnType<typeof toContentData> }> {
    const workspace = requireAdminWorkspace(request);
    const content = await this.contentService.createContent(workspace.id, {
      type: body.type,
      title: body.title ?? '',
      summary: body.summary,
      bodyMarkdown: body.bodyMarkdown ?? '',
    });

    return { data: toContentData(content) };
  }

  @Get(':contentId')
  @UseGuards(...READ_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Returns Content with the mutable Draft.' })
  public async get(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('contentId', new ParseUUIDPipe({ version: '7' })) contentId: string,
  ): Promise<{ data: ReturnType<typeof toContentData> }> {
    const workspace = requireAdminWorkspace(request);
    const content = await this.contentService.getContent(workspace.id, contentId);

    return { data: toContentData(content) };
  }

  @Patch(':contentId/draft')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Autosaves the mutable Content Draft.' })
  public async saveDraft(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('contentId', new ParseUUIDPipe({ version: '7' })) contentId: string,
    @Body() body: SaveContentDraftDto,
  ): Promise<{ data: ReturnType<typeof toContentData> }> {
    const workspace = requireAdminWorkspace(request);
    const content = await this.contentService.saveDraft(
      workspace.id,
      contentId,
      body,
    );

    return { data: toContentData(content) };
  }

  @Post(':contentId/preview')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Renders a sanitized Markdown preview.' })
  public preview(
    @Body() body: PreviewContentDto,
  ): { data: ReturnType<ContentService<unknown>['preview']> } {
    return {
      data: this.contentService.preview({
        title: body.title ?? '',
        summary: body.summary,
        bodyMarkdown: body.bodyMarkdown,
      }),
    };
  }

  @Post(':contentId/checkpoints')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({ description: 'Creates an immutable checkpoint Revision.' })
  public async checkpoint(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('contentId', new ParseUUIDPipe({ version: '7' })) contentId: string,
    @Body() body: CreateContentRevisionDto,
  ): Promise<{ data: ReturnType<typeof toContentData> }> {
    const workspace = requireAdminWorkspace(request);
    const content = await this.contentService.createCheckpoint(
      workspace.id,
      contentId,
      body,
    );

    return { data: toContentData(content) };
  }

  @Post(':contentId/ready')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({ description: 'Validates the Draft and creates a READY Revision.' })
  public async ready(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('contentId', new ParseUUIDPipe({ version: '7' })) contentId: string,
    @Body() body: CreateContentRevisionDto,
  ): Promise<{ data: ReturnType<typeof toContentData> }> {
    const workspace = requireAdminWorkspace(request);
    const content = await this.contentService.createReadyRevision(
      workspace.id,
      contentId,
      body,
    );

    return { data: toContentData(content) };
  }

  @Get(':contentId/revisions')
  @UseGuards(...READ_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Returns immutable Content Revisions.' })
  public async revisions(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('contentId', new ParseUUIDPipe({ version: '7' })) contentId: string,
  ): Promise<{ data: readonly ReturnType<typeof toRevisionData>[] }> {
    const workspace = requireAdminWorkspace(request);
    const revisions = await this.contentService.listRevisions(
      workspace.id,
      contentId,
    );

    return { data: revisions.map(toRevisionData) };
  }

  @Post(':contentId/revisions/:revisionId/restore')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Copies an immutable Revision into the mutable Draft.' })
  public async restore(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('contentId', new ParseUUIDPipe({ version: '7' })) contentId: string,
    @Param('revisionId', new ParseUUIDPipe({ version: '7' })) revisionId: string,
    @Body() body: RestoreContentRevisionDto,
  ): Promise<{ data: ReturnType<typeof toContentData> }> {
    const workspace = requireAdminWorkspace(request);
    const content = await this.contentService.restoreRevision(
      workspace.id,
      contentId,
      revisionId,
      body,
    );

    return { data: toContentData(content) };
  }

  @Post(':contentId/archive')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Archives Content and prevents further Draft changes.' })
  public async archive(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('contentId', new ParseUUIDPipe({ version: '7' })) contentId: string,
    @Body() body: ArchiveContentDto,
  ): Promise<{ data: ReturnType<typeof toContentData> }> {
    const workspace = requireAdminWorkspace(request);
    const content = await this.contentService.archiveContent(
      workspace.id,
      contentId,
      body.contentVersion,
    );

    return { data: toContentData(content) };
  }
}

function toContentData(content: Readonly<ContentRecord>) {
  return {
    id: content.id,
    workspaceId: content.workspaceId,
    type: content.type,
    status: content.status,
    version: content.version,
    currentRevisionNumber: content.currentRevisionNumber ?? null,
    readyRevisionNumber: content.readyRevisionNumber ?? null,
    archivedAt: content.archivedAt?.toISOString() ?? null,
    createdByAdminAccountId: content.createdByAdminAccountId,
    createdAt: content.createdAt.toISOString(),
    updatedAt: content.updatedAt.toISOString(),
    draft: {
      title: content.draft.title,
      summary: content.draft.summary ?? null,
      bodyMarkdown: content.draft.bodyMarkdown,
      draftVersion: content.draft.draftVersion,
      updatedByAdminAccountId: content.draft.updatedByAdminAccountId,
      updatedAt: content.draft.updatedAt.toISOString(),
    },
  };
}

function toRevisionData(revision: Readonly<ContentRevisionRecord>) {
  return {
    id: revision.id,
    contentId: revision.contentId,
    revisionNumber: revision.revisionNumber,
    kind: revision.kind,
    title: revision.title,
    summary: revision.summary ?? null,
    bodyMarkdown: revision.bodyMarkdown,
    bodyHtml: revision.bodyHtml,
    sourceDraftVersion: revision.sourceDraftVersion,
    note: revision.note ?? null,
    createdByAdminAccountId: revision.createdByAdminAccountId,
    createdAt: revision.createdAt.toISOString(),
  };
}
