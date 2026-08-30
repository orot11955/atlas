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

import {
  AdminPermission,
  ApiClientStatus,
  systemClock,
  type ApiClientAdministrationService,
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
import { toApiClientCredentialData, toApiClientData } from './api-client.presenter';
import { API_CLIENT_ADMINISTRATION_SERVICE } from './api-client.tokens';
import { ApiClientListQueryDto } from './dto/api-client-list-query.dto';
import { ApiClientStatusTransitionDto } from './dto/api-client-status-transition.dto';
import { CreateApiClientDto } from './dto/create-api-client.dto';
import { RotateApiClientKeyDto } from './dto/rotate-api-client-key.dto';
import { UpdateApiClientDto } from './dto/update-api-client.dto';

@ApiTags('Admin API Clients')
@Controller('admin/v1/api-clients')
export class AdminApiClientController {
  public constructor(
    @Inject(API_CLIENT_ADMINISTRATION_SERVICE)
    private readonly service: ApiClientAdministrationService<unknown>,
  ) {}

  @Get()
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.API_CLIENTS_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Returns API Clients in the default Workspace.' })
  public async list(
    @Req() request: AdminWorkspaceHttpRequest,
    @Query() query: ApiClientListQueryDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const clients = await this.service.listClients(workspace.id, query);
    const now = systemClock.now();

    return { data: clients.map((client) => toApiClientData(client, now)) };
  }

  @Post()
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.API_CLIENTS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({ description: 'Creates an API Client and returns its API Key once.' })
  public async create(@Req() request: AdminWorkspaceHttpRequest, @Body() body: CreateApiClientDto) {
    const workspace = requireAdminWorkspace(request);
    const result = await this.service.createClient(workspace.id, {
      ...body,
      expiresAt: parseOptionalDate(body.expiresAt),
    });

    return {
      data: {
        client: toApiClientData(result.client, systemClock.now()),
        credential: toApiClientCredentialData(result.credential),
      },
    };
  }

  @Get(':apiClientId')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.API_CLIENTS_READ)
  @Header('Cache-Control', 'no-store')
  public async get(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('apiClientId', new ParseUUIDPipe({ version: '7' }))
    apiClientId: string,
  ) {
    const workspace = requireAdminWorkspace(request);
    const client = await this.service.getClient(workspace.id, apiClientId);
    return { data: toApiClientData(client, systemClock.now()) };
  }

  @Patch(':apiClientId')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.API_CLIENTS_MANAGE)
  @Header('Cache-Control', 'no-store')
  public async update(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('apiClientId', new ParseUUIDPipe({ version: '7' }))
    apiClientId: string,
    @Body() body: UpdateApiClientDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const client = await this.service.updateClient(workspace.id, apiClientId, body);
    return { data: toApiClientData(client, systemClock.now()) };
  }

  @Post(':apiClientId/keys/rotate')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.API_CLIENTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async rotateKey(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('apiClientId', new ParseUUIDPipe({ version: '7' }))
    apiClientId: string,
    @Body() body: RotateApiClientKeyDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const result = await this.service.rotateKey(workspace.id, apiClientId, {
      gracePeriodSeconds: body.gracePeriodSeconds,
      expiresAt: parseOptionalDate(body.expiresAt),
    });

    return {
      data: {
        client: toApiClientData(result.client, systemClock.now()),
        credential: toApiClientCredentialData(result.credential),
      },
    };
  }

  @Post(':apiClientId/keys/:keyId/revoke')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.API_CLIENTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async revokeKey(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('apiClientId', new ParseUUIDPipe({ version: '7' }))
    apiClientId: string,
    @Param('keyId', new ParseUUIDPipe({ version: '7' })) keyId: string,
  ) {
    const workspace = requireAdminWorkspace(request);
    const client = await this.service.revokeKey(workspace.id, apiClientId, keyId);
    return { data: toApiClientData(client, systemClock.now()) };
  }

  @Post(':apiClientId/enable')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.API_CLIENTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  public enable(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('apiClientId', new ParseUUIDPipe({ version: '7' }))
    apiClientId: string,
    @Body() body: ApiClientStatusTransitionDto,
  ) {
    return this.changeStatus(request, apiClientId, ApiClientStatus.ACTIVE, body.version);
  }

  @Post(':apiClientId/disable')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.API_CLIENTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  public disable(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('apiClientId', new ParseUUIDPipe({ version: '7' }))
    apiClientId: string,
    @Body() body: ApiClientStatusTransitionDto,
  ) {
    return this.changeStatus(request, apiClientId, ApiClientStatus.DISABLED, body.version);
  }

  @Post(':apiClientId/archive')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.API_CLIENTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  public archive(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('apiClientId', new ParseUUIDPipe({ version: '7' }))
    apiClientId: string,
    @Body() body: ApiClientStatusTransitionDto,
  ) {
    return this.changeStatus(request, apiClientId, ApiClientStatus.ARCHIVED, body.version);
  }

  private async changeStatus(
    request: AdminWorkspaceHttpRequest,
    apiClientId: string,
    status: ApiClientStatus,
    version: number,
  ) {
    const workspace = requireAdminWorkspace(request);
    const client = await this.service.changeStatus(workspace.id, apiClientId, status, version);
    return { data: toApiClientData(client, systemClock.now()) };
  }
}

function parseOptionalDate(value?: string): Date | undefined {
  return value ? new Date(value) : undefined;
}
