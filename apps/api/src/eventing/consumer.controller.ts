import { Body, Controller, Get, Header, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { AdminPermission, type ConsumerState, type ReplayReason, type OutboxAdministrationService } from '@atlas/server';
import { AdminCsrfGuard } from '../admin-session/admin-csrf.guard';
import { AdminPermissionGuard, RequireAdminPermission } from '../admin-session/admin-permission.guard';
import { AdminSessionGuard } from '../admin-session/admin-session.guard';
import { AdminWorkspaceGuard } from '../admin-sites/admin-workspace.guard';
import { requireAdminWorkspace, type AdminWorkspaceHttpRequest } from '../admin-sites/admin-workspace.request';
import { OUTBOX_ADMINISTRATION_SERVICE } from './eventing.tokens';

export class ConsumerQueryDto {
  @IsOptional()
  @IsIn(['pending', 'processing', 'failed', 'dead', 'succeeded'])
  public status?: ConsumerState;

  @IsOptional()
  @Matches(/^(?:[1-9]\d?|1\d\d|200)$/u)
  public limit?: string;
}
export class ConsumerReplayDto {
  @IsUUID('7')
  public replayId!: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_642)
  public expectedAttempt!: number;

  @IsIn(['dependency-restored', 'handler-upgraded', 'operator-reviewed'])
  public reason!: ReplayReason;
}

@ApiTags('Admin Eventing')
@Controller('admin/v1/eventing/consumptions')
export class ConsumerController {
  public constructor(@Inject(OUTBOX_ADMINISTRATION_SERVICE) private readonly service: OutboxAdministrationService<unknown>) {}

  @Get()
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.SITES_READ)
  @Header('Cache-Control', 'no-store')
  public async list(@Req() request: AdminWorkspaceHttpRequest, @Query() query: ConsumerQueryDto) {
    const items = await this.service.listConsumptions(requireAdminWorkspace(request).id, query.status, query.limit ? Number(query.limit) : 50);
    return { data: { items } };
  }

  @Get(':eventId/history')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.SITES_READ)
  @Header('Cache-Control', 'no-store')
  public async history(@Req() request: AdminWorkspaceHttpRequest,
    @Param('eventId', new ParseUUIDPipe({ version: '7' })) eventId: string,
    @Query() query: ConsumerQueryDto) {
    return { data: await this.service.consumptionHistory(requireAdminWorkspace(request).id, eventId, query.limit ? Number(query.limit) : 50) };
  }

  @Post(':eventId/replay')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  public async replay(@Req() request: AdminWorkspaceHttpRequest,
    @Param('eventId', new ParseUUIDPipe({ version: '7' })) eventId: string,
    @Body() body: ConsumerReplayDto) {
    return { data: await this.service.replayConsumption(requireAdminWorkspace(request).id, { ...body, eventId }) };
  }
}
