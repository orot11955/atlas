FILES = {
    'packages/database/src/migrations/1788024000000-CreateSiteApiClients.ts': r'''import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSiteApiClients1788024000000 implements MigrationInterface {
  public readonly name = 'CreateSiteApiClients1788024000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "api_clients" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "site_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "status" varchar(16) NOT NULL,
        "allowed_origins" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "rate_limit_per_minute" integer NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "last_used_at" timestamptz,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "pk_api_clients" PRIMARY KEY ("id"),
        CONSTRAINT "fk_api_clients_site_workspace"
          FOREIGN KEY ("site_id", "workspace_id")
          REFERENCES "sites" ("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "chk_api_clients_name"
          CHECK (char_length(btrim("name")) BETWEEN 2 AND 120),
        CONSTRAINT "chk_api_clients_status"
          CHECK ("status" IN ('active', 'disabled', 'revoked')),
        CONSTRAINT "chk_api_clients_origins_array"
          CHECK (jsonb_typeof("allowed_origins") = 'array'),
        CONSTRAINT "chk_api_clients_rate_limit"
          CHECK ("rate_limit_per_minute" BETWEEN 1 AND 10000),
        CONSTRAINT "chk_api_clients_version" CHECK ("version" >= 1),
        CONSTRAINT "chk_api_clients_revocation" CHECK (
          ("status" = 'revoked' AND "revoked_at" IS NOT NULL)
          OR ("status" <> 'revoked' AND "revoked_at" IS NULL)
        )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_api_clients_site_name_lower"
      ON "api_clients" ("site_id", lower("name"))
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_api_clients_site_created_at"
      ON "api_clients" ("site_id", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "api_client_scopes" (
        "api_client_id" uuid NOT NULL,
        "scope" varchar(64) NOT NULL,
        CONSTRAINT "pk_api_client_scopes" PRIMARY KEY ("api_client_id", "scope"),
        CONSTRAINT "fk_api_client_scopes_client"
          FOREIGN KEY ("api_client_id") REFERENCES "api_clients" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_api_client_scopes_scope"
          CHECK ("scope" IN ('site:read', 'content:read', 'feed:read'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "api_client_keys" (
        "id" uuid NOT NULL,
        "api_client_id" uuid NOT NULL,
        "key_prefix" varchar(32) NOT NULL,
        "secret_digest" char(64) NOT NULL,
        "status" varchar(16) NOT NULL,
        "not_before" timestamptz NOT NULL,
        "expires_at" timestamptz,
        "grace_expires_at" timestamptz,
        "last_used_at" timestamptz,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "pk_api_client_keys" PRIMARY KEY ("id"),
        CONSTRAINT "uq_api_client_keys_prefix" UNIQUE ("key_prefix"),
        CONSTRAINT "fk_api_client_keys_client"
          FOREIGN KEY ("api_client_id") REFERENCES "api_clients" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_api_client_keys_prefix"
          CHECK ("key_prefix" ~ '^atlas_live_[0-9a-f]{8}$'),
        CONSTRAINT "chk_api_client_keys_digest"
          CHECK ("secret_digest" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "chk_api_client_keys_status"
          CHECK ("status" IN ('active', 'grace', 'revoked')),
        CONSTRAINT "chk_api_client_keys_expiration"
          CHECK ("expires_at" IS NULL OR "expires_at" > "created_at"),
        CONSTRAINT "chk_api_client_keys_lifecycle" CHECK (
          ("status" = 'active' AND "grace_expires_at" IS NULL AND "revoked_at" IS NULL)
          OR (
            "status" = 'grace'
            AND "grace_expires_at" IS NOT NULL
            AND "grace_expires_at" > "created_at"
            AND "revoked_at" IS NULL
          )
          OR (
            "status" = 'revoked'
            AND "grace_expires_at" IS NULL
            AND "revoked_at" IS NOT NULL
          )
        )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_api_client_keys_active"
      ON "api_client_keys" ("api_client_id")
      WHERE "status" = 'active'
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_api_client_keys_client_created_at"
      ON "api_client_keys" ("api_client_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "api_client_keys"');
    await queryRunner.query('DROP TABLE "api_client_scopes"');
    await queryRunner.query('DROP TABLE "api_clients"');
  }
}
''',
    'apps/api/src/api-clients/api-client.tokens.ts': r'''export const API_CLIENT_REPOSITORY = Symbol('API_CLIENT_REPOSITORY');
export const API_CLIENT_TOKEN_ISSUER = Symbol('API_CLIENT_TOKEN_ISSUER');
export const API_CLIENT_RATE_LIMITER = Symbol('API_CLIENT_RATE_LIMITER');
export const API_CLIENT_MANAGEMENT_SERVICE = Symbol(
  'API_CLIENT_MANAGEMENT_SERVICE',
);
export const API_CLIENT_AUTHENTICATION_SERVICE = Symbol(
  'API_CLIENT_AUTHENTICATION_SERVICE',
);
''',
    'apps/api/src/api-clients/api-client.request.ts': r'''import type { ApiClientPrincipal } from '@atlas/server';

export interface ApiClientHttpRequest {
  headers: {
    authorization?: string | string[];
    origin?: string | string[];
  };
  apiClient?: Readonly<ApiClientPrincipal>;
}

export function readSingleApiClientHeader(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  return Array.isArray(value) && value.length === 1 ? value[0] : undefined;
}

export function requireApiClientPrincipal(
  request: ApiClientHttpRequest,
): Readonly<ApiClientPrincipal> {
  if (!request.apiClient) {
    throw new Error('API Client principal is not available.');
  }

  return request.apiClient;
}
''',
    'apps/api/src/api-clients/api-client-auth.guard.ts': r'''import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';

import type { ApiClientAuthenticationService } from '@atlas/server';

import {
  readSingleApiClientHeader,
  type ApiClientHttpRequest,
} from './api-client.request';
import { API_CLIENT_AUTHENTICATION_SERVICE } from './api-client.tokens';

@Injectable()
export class ApiClientAuthGuard implements CanActivate {
  public constructor(
    @Inject(API_CLIENT_AUTHENTICATION_SERVICE)
    private readonly authenticationService: ApiClientAuthenticationService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiClientHttpRequest>();
    const principal = await this.authenticationService.authenticate({
      authorization: readSingleApiClientHeader(request.headers.authorization),
      origin: readSingleApiClientHeader(request.headers.origin),
    });

    request.apiClient = principal;
    this.authenticationService.enterRequestContext(principal);
    return true;
  }
}
''',
    'apps/api/src/api-clients/api-client-scope.guard.ts': r'''import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type {
  ApiClientAuthenticationService,
  ApiClientScope,
} from '@atlas/server';

import {
  requireApiClientPrincipal,
  type ApiClientHttpRequest,
} from './api-client.request';
import { API_CLIENT_AUTHENTICATION_SERVICE } from './api-client.tokens';

const API_CLIENT_SCOPE_METADATA = 'atlas:api-client-scope';

export const RequireApiClientScope = (
  scope: ApiClientScope,
): MethodDecorator & ClassDecorator =>
  SetMetadata(API_CLIENT_SCOPE_METADATA, scope);

@Injectable()
export class ApiClientScopeGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    @Inject(API_CLIENT_AUTHENTICATION_SERVICE)
    private readonly authenticationService: ApiClientAuthenticationService,
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const scope = this.reflector.getAllAndOverride<ApiClientScope | undefined>(
      API_CLIENT_SCOPE_METADATA,
      [context.getHandler(), context.getClass()],
    );

    if (!scope) {
      return true;
    }

    const request = context.switchToHttp().getRequest<ApiClientHttpRequest>();
    this.authenticationService.assertScope(
      requireApiClientPrincipal(request),
      scope,
    );
    return true;
  }
}
''',
    'apps/api/src/api-clients/redis-api-client-rate-limiter.ts': r'''import type { OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import type {
  ApiClientRateLimiterPort,
  ApiClientRateLimitResult,
} from '@atlas/server';

const WINDOW_MILLISECONDS = 60_000;
const RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

export class RedisApiClientRateLimiter
  implements ApiClientRateLimiterPort, OnModuleDestroy
{
  private readonly redis: Redis;

  public constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  public async consume(
    key: string,
    limit: number,
    _now: Date,
  ): Promise<Readonly<ApiClientRateLimitResult>> {
    if (this.redis.status === 'wait') {
      await this.redis.connect();
    }

    const result = (await this.redis.eval(
      RATE_LIMIT_SCRIPT,
      1,
      `atlas:api-client:rate:${key}`,
      WINDOW_MILLISECONDS,
    )) as [number, number];
    const count = Number(result[0]);
    const ttlMilliseconds = Math.max(1, Number(result[1]));

    return Object.freeze({
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil(ttlMilliseconds / 1_000)),
    });
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.redis.status !== 'end') {
      await this.redis.quit();
    }
  }
}
''',
    'apps/api/src/api-clients/dto/create-api-client.dto.ts': r'''import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';

import { API_CLIENT_SCOPES, type ApiClientScope } from '@atlas/server';

export class CreateApiClientDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @IsString()
  @Length(2, 120)
  public name!: string;

  @ApiProperty({ enum: API_CLIENT_SCOPES, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn([...API_CLIENT_SCOPES], { each: true })
  public scopes!: ApiClientScope[];

  @ApiPropertyOptional({ type: [String], maxItems: 20 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { each: true },
  )
  public allowedOrigins?: string[];

  @ApiProperty({ minimum: 1, maximum: 10000, default: 120 })
  @IsInt()
  @Min(1)
  @Max(10_000)
  public rateLimitPerMinute!: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString({ strict: true })
  public expiresAt?: string;
}
''',
    'apps/api/src/api-clients/dto/update-api-client.dto.ts': r'''import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';

import { API_CLIENT_SCOPES, type ApiClientScope } from '@atlas/server';

export class UpdateApiClientDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  public version!: number;

  @ApiProperty({ minLength: 2, maxLength: 120 })
  @IsString()
  @Length(2, 120)
  public name!: string;

  @ApiProperty({ enum: API_CLIENT_SCOPES, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn([...API_CLIENT_SCOPES], { each: true })
  public scopes!: ApiClientScope[];

  @ApiPropertyOptional({ type: [String], maxItems: 20 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { each: true },
  )
  public allowedOrigins?: string[];

  @ApiProperty({ minimum: 1, maximum: 10000 })
  @IsInt()
  @Min(1)
  @Max(10_000)
  public rateLimitPerMinute!: number;
}
''',
    'apps/api/src/api-clients/dto/rotate-api-client-key.dto.ts': r'''import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class RotateApiClientKeyDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 604800, default: 3600 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(604_800)
  public graceSeconds?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString({ strict: true })
  public expiresAt?: string;
}
''',
    'apps/api/src/api-clients/dto/api-client-status.dto.ts': r'''import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class ApiClientStatusDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  public version!: number;
}
''',
    'apps/api/src/api-clients/admin-api-client.controller.ts': r'''import {
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
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import {
  AdminPermission,
  ApiClientStatus,
  type ApiClientAggregate,
  type ApiClientManagementService,
  type IssuedApiClientKeyResult,
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
import { API_CLIENT_MANAGEMENT_SERVICE } from './api-client.tokens';
import { ApiClientStatusDto } from './dto/api-client-status.dto';
import { CreateApiClientDto } from './dto/create-api-client.dto';
import { RotateApiClientKeyDto } from './dto/rotate-api-client-key.dto';
import { UpdateApiClientDto } from './dto/update-api-client.dto';

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

@ApiTags('Admin API Clients')
@Controller('admin/v1/sites/:siteId/api-clients')
export class AdminApiClientController {
  public constructor(
    @Inject(API_CLIENT_MANAGEMENT_SERVICE)
    private readonly managementService: ApiClientManagementService<unknown>,
  ) {}

  @Get()
  @UseGuards(...READ_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Returns API Clients for a Site.' })
  public async listClients(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('siteId', new ParseUUIDPipe({ version: '7' })) siteId: string,
  ) {
    const workspace = requireAdminWorkspace(request);
    const clients = await this.managementService.listClients(workspace.id, siteId);
    return { data: clients.map(toClientData) };
  }

  @Post()
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({
    description: 'Creates an API Client and returns the Key once.',
  })
  public async createClient(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('siteId', new ParseUUIDPipe({ version: '7' })) siteId: string,
    @Body() body: CreateApiClientDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const result = await this.managementService.createClient(workspace.id, siteId, {
      ...body,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });
    return { data: toIssuedData(result) };
  }

  @Get(':clientId')
  @UseGuards(...READ_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_READ)
  @Header('Cache-Control', 'no-store')
  public async getClient(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('siteId', new ParseUUIDPipe({ version: '7' })) siteId: string,
    @Param('clientId', new ParseUUIDPipe({ version: '7' })) clientId: string,
  ) {
    const workspace = requireAdminWorkspace(request);
    const client = await this.managementService.getClient(
      workspace.id,
      siteId,
      clientId,
    );
    return { data: toClientData(client) };
  }

  @Patch(':clientId')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @Header('Cache-Control', 'no-store')
  public async updateClient(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('siteId', new ParseUUIDPipe({ version: '7' })) siteId: string,
    @Param('clientId', new ParseUUIDPipe({ version: '7' })) clientId: string,
    @Body() body: UpdateApiClientDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const client = await this.managementService.updateClient(
      workspace.id,
      siteId,
      clientId,
      body,
    );
    return { data: toClientData(client) };
  }

  @Post(':clientId/rotate')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  public async rotateKey(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('siteId', new ParseUUIDPipe({ version: '7' })) siteId: string,
    @Param('clientId', new ParseUUIDPipe({ version: '7' })) clientId: string,
    @Body() body: RotateApiClientKeyDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const result = await this.managementService.rotateKey(
      workspace.id,
      siteId,
      clientId,
      {
        graceSeconds: body.graceSeconds,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      },
    );
    return { data: toIssuedData(result) };
  }

  @Post(':clientId/enable')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @Header('Cache-Control', 'no-store')
  public enableClient(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('siteId', new ParseUUIDPipe({ version: '7' })) siteId: string,
    @Param('clientId', new ParseUUIDPipe({ version: '7' })) clientId: string,
    @Body() body: ApiClientStatusDto,
  ) {
    return this.changeStatus(
      request,
      siteId,
      clientId,
      ApiClientStatus.ACTIVE,
      body.version,
    );
  }

  @Post(':clientId/disable')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @Header('Cache-Control', 'no-store')
  public disableClient(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('siteId', new ParseUUIDPipe({ version: '7' })) siteId: string,
    @Param('clientId', new ParseUUIDPipe({ version: '7' })) clientId: string,
    @Body() body: ApiClientStatusDto,
  ) {
    return this.changeStatus(
      request,
      siteId,
      clientId,
      ApiClientStatus.DISABLED,
      body.version,
    );
  }

  @Post(':clientId/revoke')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @Header('Cache-Control', 'no-store')
  public revokeClient(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('siteId', new ParseUUIDPipe({ version: '7' })) siteId: string,
    @Param('clientId', new ParseUUIDPipe({ version: '7' })) clientId: string,
    @Body() body: ApiClientStatusDto,
  ) {
    return this.changeStatus(
      request,
      siteId,
      clientId,
      ApiClientStatus.REVOKED,
      body.version,
    );
  }

  @Post(':clientId/keys/:keyId/revoke')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  public async revokeKey(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('siteId', new ParseUUIDPipe({ version: '7' })) siteId: string,
    @Param('clientId', new ParseUUIDPipe({ version: '7' })) clientId: string,
    @Param('keyId', new ParseUUIDPipe({ version: '7' })) keyId: string,
  ): Promise<void> {
    const workspace = requireAdminWorkspace(request);
    await this.managementService.revokeKey(
      workspace.id,
      siteId,
      clientId,
      keyId,
    );
  }

  private async changeStatus(
    request: AdminWorkspaceHttpRequest,
    siteId: string,
    clientId: string,
    status: ApiClientStatus,
    version: number,
  ) {
    const workspace = requireAdminWorkspace(request);
    const client = await this.managementService.setStatus(
      workspace.id,
      siteId,
      clientId,
      status,
      version,
    );
    return { data: toClientData(client) };
  }
}

function toClientData(client: Readonly<ApiClientAggregate>) {
  return {
    id: client.id,
    workspaceId: client.workspaceId,
    siteId: client.siteId,
    name: client.name,
    status: client.status,
    scopes: client.scopes,
    allowedOrigins: client.allowedOrigins,
    rateLimitPerMinute: client.rateLimitPerMinute,
    version: client.version,
    ...(client.lastUsedAt
      ? { lastUsedAt: client.lastUsedAt.toISOString() }
      : {}),
    ...(client.revokedAt ? { revokedAt: client.revokedAt.toISOString() } : {}),
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
    keys: client.keys.map((key) => ({
      id: key.id,
      keyPrefix: key.keyPrefix,
      status: key.status,
      notBefore: key.notBefore.toISOString(),
      ...(key.expiresAt ? { expiresAt: key.expiresAt.toISOString() } : {}),
      ...(key.graceExpiresAt
        ? { graceExpiresAt: key.graceExpiresAt.toISOString() }
        : {}),
      ...(key.lastUsedAt ? { lastUsedAt: key.lastUsedAt.toISOString() } : {}),
      ...(key.revokedAt ? { revokedAt: key.revokedAt.toISOString() } : {}),
      createdAt: key.createdAt.toISOString(),
    })),
  };
}

function toIssuedData(result: Readonly<IssuedApiClientKeyResult>) {
  return {
    client: toClientData(result.client),
    issuedKey: {
      id: result.issuedKey.id,
      token: result.issuedKey.token,
      keyPrefix: result.issuedKey.keyPrefix,
      status: result.issuedKey.status,
      notBefore: result.issuedKey.notBefore.toISOString(),
      ...(result.issuedKey.expiresAt
        ? { expiresAt: result.issuedKey.expiresAt.toISOString() }
        : {}),
      createdAt: result.issuedKey.createdAt.toISOString(),
    },
  };
}
''',
    'apps/api/src/api-clients/delivery-site.controller.ts': r'''import {
  Controller,
  Get,
  Inject,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  ApiClientScope,
  type ApiClientAuthenticationService,
} from '@atlas/server';

import { ApiClientAuthGuard } from './api-client-auth.guard';
import {
  requireApiClientPrincipal,
  type ApiClientHttpRequest,
} from './api-client.request';
import {
  ApiClientScopeGuard,
  RequireApiClientScope,
} from './api-client-scope.guard';
import { API_CLIENT_AUTHENTICATION_SERVICE } from './api-client.tokens';

@ApiTags('Delivery Sites')
@ApiBearerAuth()
@Controller('delivery/v1/sites')
export class DeliverySiteController {
  public constructor(
    @Inject(API_CLIENT_AUTHENTICATION_SERVICE)
    private readonly authenticationService: ApiClientAuthenticationService,
  ) {}

  @Get(':siteKey')
  @UseGuards(ApiClientAuthGuard, ApiClientScopeGuard)
  @RequireApiClientScope(ApiClientScope.SITE_READ)
  @ApiOkResponse({ description: 'Returns the Site bound to the API Client.' })
  @ApiUnauthorizedResponse({ description: 'A valid Site API Client Key is required.' })
  public getSite(
    @Req() request: ApiClientHttpRequest,
    @Param('siteKey') siteKey: string,
  ) {
    const principal = requireApiClientPrincipal(request);
    this.authenticationService.assertSiteKey(principal, siteKey);

    return {
      data: {
        id: principal.siteId,
        key: principal.siteKey,
        name: principal.siteName,
      },
    };
  }
}
''',
    'apps/api/src/api-clients/api-client.module.ts': r'''import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import type { ApiEnvironment } from '@atlas/config';
import {
  ApiClientAuthenticationService,
  ApiClientEntity,
  ApiClientKeyEntity,
  ApiClientManagementService,
  ApiClientScopeEntity,
  HmacApiClientTokenIssuer,
  SiteEntity,
  TypeOrmApiClientRepository,
  TypeOrmSiteRepository,
  type ApiClientRateLimiterPort,
  type ApiClientRepositoryPort,
  type ApiClientTokenIssuerPort,
  type AuditService,
  type SiteRepositoryPort,
  type TransactionRunner,
} from '@atlas/server';

import { AdminSessionModule } from '../admin-session/admin-session.module';
import { AdminWorkspaceSiteModule } from '../admin-sites/admin-workspace-site.module';
import { PlatformModule } from '../platform/platform.module';
import {
  AUDIT_SERVICE,
  TRANSACTION_RUNNER,
} from '../platform/platform.tokens';
import { AdminApiClientController } from './admin-api-client.controller';
import { ApiClientAuthGuard } from './api-client-auth.guard';
import { ApiClientScopeGuard } from './api-client-scope.guard';
import {
  API_CLIENT_AUTHENTICATION_SERVICE,
  API_CLIENT_MANAGEMENT_SERVICE,
  API_CLIENT_RATE_LIMITER,
  API_CLIENT_REPOSITORY,
  API_CLIENT_TOKEN_ISSUER,
} from './api-client.tokens';
import { DeliverySiteController } from './delivery-site.controller';
import { RedisApiClientRateLimiter } from './redis-api-client-rate-limiter';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApiClientEntity,
      ApiClientScopeEntity,
      ApiClientKeyEntity,
      SiteEntity,
    ]),
    PlatformModule,
    AdminSessionModule,
    AdminWorkspaceSiteModule,
  ],
  controllers: [AdminApiClientController, DeliverySiteController],
  providers: [
    {
      provide: API_CLIENT_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) =>
        new TypeOrmApiClientRepository(dataSource),
    },
    {
      provide: API_CLIENT_TOKEN_ISSUER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnvironment, true>) =>
        new HmacApiClientTokenIssuer(
          config.get('AUTH_API_KEY_PEPPER', { infer: true }),
        ),
    },
    {
      provide: API_CLIENT_RATE_LIMITER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnvironment, true>) =>
        new RedisApiClientRateLimiter(
          config.get('REDIS_URL', { infer: true }),
        ),
    },
    {
      provide: API_CLIENT_MANAGEMENT_SERVICE,
      inject: [
        TRANSACTION_RUNNER,
        API_CLIENT_REPOSITORY,
        DataSource,
        API_CLIENT_TOKEN_ISSUER,
        AUDIT_SERVICE,
        ConfigService,
      ],
      useFactory: (
        transactionRunner: TransactionRunner<EntityManager>,
        repository: ApiClientRepositoryPort<EntityManager>,
        dataSource: DataSource,
        tokenIssuer: ApiClientTokenIssuerPort,
        auditService: AuditService<EntityManager>,
        config: ConfigService<ApiEnvironment, true>,
      ) =>
        new ApiClientManagementService(
          transactionRunner,
          repository,
          new TypeOrmSiteRepository(dataSource) as SiteRepositoryPort<EntityManager>,
          tokenIssuer,
          auditService,
          config.get('API_CLIENT_KEY_GRACE_SECONDS', { infer: true }) * 1_000,
        ),
    },
    {
      provide: API_CLIENT_AUTHENTICATION_SERVICE,
      inject: [
        API_CLIENT_REPOSITORY,
        API_CLIENT_TOKEN_ISSUER,
        API_CLIENT_RATE_LIMITER,
        ConfigService,
      ],
      useFactory: (
        repository: ApiClientRepositoryPort<EntityManager>,
        tokenIssuer: ApiClientTokenIssuerPort,
        rateLimiter: ApiClientRateLimiterPort,
        config: ConfigService<ApiEnvironment, true>,
      ) =>
        new ApiClientAuthenticationService(
          repository,
          tokenIssuer,
          rateLimiter,
          config.get('API_CLIENT_USAGE_TOUCH_SECONDS', { infer: true }) * 1_000,
        ),
    },
    ApiClientAuthGuard,
    ApiClientScopeGuard,
  ],
  exports: [
    API_CLIENT_MANAGEMENT_SERVICE,
    API_CLIENT_AUTHENTICATION_SERVICE,
    ApiClientAuthGuard,
    ApiClientScopeGuard,
  ],
})
export class ApiClientModule {}
''',
}
