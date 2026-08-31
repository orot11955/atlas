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
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import {
  AdminPermission,
  type AssetRecord,
  type AssetService,
  type AssetUploadSessionView,
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
import { AssetListQueryDto, CreateAssetUploadSessionDto } from './media.dto';
import { ASSET_SERVICE } from './media.tokens';

const READ_GUARDS = [AdminSessionGuard, AdminWorkspaceGuard, AdminPermissionGuard] as const;
const WRITE_GUARDS = [
  AdminSessionGuard,
  AdminWorkspaceGuard,
  AdminCsrfGuard,
  AdminPermissionGuard,
] as const;

@ApiTags('Admin Media')
@Controller('admin/v1/assets')
export class MediaController {
  public constructor(
    @Inject(ASSET_SERVICE)
    private readonly assetService: AssetService<unknown>,
  ) {}

  @Get()
  @UseGuards(...READ_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Returns Workspace Assets without storage internals.' })
  public async list(@Req() request: AdminWorkspaceHttpRequest, @Query() query: AssetListQueryDto) {
    const workspace = requireAdminWorkspace(request);
    const assets = await this.assetService.listAssets(
      workspace.id,
      query.limit ? Number(query.limit) : undefined,
    );

    return { data: { items: assets.map(toAssetData) } };
  }

  @Get(':assetId')
  @UseGuards(...READ_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Returns one Workspace Asset without Bucket or Object Key.' })
  public async get(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('assetId', new ParseUUIDPipe({ version: '7' })) assetId: string,
  ) {
    const workspace = requireAdminWorkspace(request);
    const asset = await this.assetService.getAsset(workspace.id, assetId);
    return { data: toAssetData(asset) };
  }

  @Post('upload-sessions')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({ description: 'Creates a private Asset Upload Session and Presigned PUT.' })
  public async createUploadSession(
    @Req() request: AdminWorkspaceHttpRequest,
    @Body() body: CreateAssetUploadSessionDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const result = await this.assetService.createUploadSession(workspace.id, body);

    return {
      data: {
        asset: toAssetData(result.asset),
        uploadSession: toUploadSessionData(result.session),
        upload: {
          method: result.upload.method,
          url: result.upload.url,
          expiresAt: result.upload.expiresAt.toISOString(),
          headers: result.upload.headers,
        },
      },
    };
  }

  @Post('upload-sessions/:uploadSessionId/complete')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Verifies and finalizes a private Asset upload.' })
  public async completeUpload(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('uploadSessionId', new ParseUUIDPipe({ version: '7' })) uploadSessionId: string,
  ) {
    const workspace = requireAdminWorkspace(request);
    const asset = await this.assetService.completeUpload(workspace.id, uploadSessionId);
    return { data: toAssetData(asset) };
  }
}

function toAssetData(asset: Readonly<AssetRecord>) {
  return {
    id: asset.id,
    kind: asset.kind,
    status: asset.status,
    originalFileName: asset.originalFileName,
    declaredContentType: asset.declaredContentType,
    detectedContentType: asset.detectedContentType ?? null,
    expectedSize: asset.expectedSize,
    actualSize: asset.actualSize ?? null,
    sha256: asset.sha256,
    version: asset.version,
    uploadedAt: asset.uploadedAt?.toISOString() ?? null,
    failedAt: asset.failedAt?.toISOString() ?? null,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  };
}

function toUploadSessionData(session: Readonly<AssetUploadSessionView>) {
  return {
    id: session.id,
    assetId: session.assetId,
    status: session.status,
    expectedSize: session.expectedSize,
    expectedSha256: session.expectedSha256,
    declaredContentType: session.declaredContentType,
    expiresAt: session.expiresAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
    failedAt: session.failedAt?.toISOString() ?? null,
  };
}
