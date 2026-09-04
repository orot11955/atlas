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
  type OutboxAdministrationService,
  type OutboxEventRecord,
  type PublicationScheduleRecord,
  type PublicationSchedulingService,
  type WebhookAdministrationService,
  type WebhookDeliveryView,
  type WebhookEndpointView,
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
  CreatePublicationScheduleDto,
  CreateWebhookEndpointDto,
  OutboxListQueryDto,
  PublicationScheduleListQueryDto,
  UpdateWebhookEndpointDto,
  VersionDto,
  WebhookDeliveryListQueryDto,
  WebhookEndpointListQueryDto,
} from './eventing.dto';
import {
  OUTBOX_ADMINISTRATION_SERVICE,
  PUBLICATION_SCHEDULING_SERVICE,
  WEBHOOK_ADMINISTRATION_SERVICE,
} from './eventing.tokens';

const READ_GUARDS = [AdminSessionGuard, AdminWorkspaceGuard, AdminPermissionGuard] as const;
const WRITE_GUARDS = [
  AdminSessionGuard,
  AdminWorkspaceGuard,
  AdminCsrfGuard,
  AdminPermissionGuard,
] as const;

@ApiTags('Admin Eventing')
@Controller('admin/v1')
export class EventingController {
  public constructor(
    @Inject(OUTBOX_ADMINISTRATION_SERVICE)
    private readonly outboxService: OutboxAdministrationService<unknown>,
    @Inject(WEBHOOK_ADMINISTRATION_SERVICE)
    private readonly webhookService: WebhookAdministrationService<unknown>,
    @Inject(PUBLICATION_SCHEDULING_SERVICE)
    private readonly schedulingService: PublicationSchedulingService<unknown>,
  ) {}

  @Get('eventing/outbox')
  @UseGuards(...READ_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Returns Outbox Events without payload or secret material.' })
  public async listOutbox(
    @Req() request: AdminWorkspaceHttpRequest,
    @Query() query: OutboxListQueryDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const records = await this.outboxService.list(workspace.id, {
      status: query.status,
      limit: query.limit ? Number(query.limit) : undefined,
    });

    return { data: { items: records.map(toOutboxData) } };
  }

  @Post('eventing/outbox/:eventId/retry')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  public async retryOutbox(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('eventId', new ParseUUIDPipe({ version: '7' })) eventId: string,
  ) {
    const workspace = requireAdminWorkspace(request);
    await this.outboxService.retry(workspace.id, eventId);

    return { data: { eventId, status: 'pending' } };
  }

  @Get('webhook-endpoints')
  @UseGuards(...READ_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_READ)
  @Header('Cache-Control', 'no-store')
  public async listWebhookEndpoints(
    @Req() request: AdminWorkspaceHttpRequest,
    @Query() query: WebhookEndpointListQueryDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const records = await this.webhookService.listEndpoints(workspace.id, query.siteId);

    return { data: { items: records.map(toWebhookEndpointData) } };
  }

  @Post('webhook-endpoints')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Creates a Site-scoped Webhook and returns its secret once.' })
  @Header('Cache-Control', 'no-store')
  public async createWebhookEndpoint(
    @Req() request: AdminWorkspaceHttpRequest,
    @Body() body: CreateWebhookEndpointDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const result = await this.webhookService.createEndpoint(workspace.id, body);

    return {
      data: {
        endpoint: toWebhookEndpointData(result.endpoint),
        secret: result.secret,
      },
    };
  }

  @Patch('webhook-endpoints/:endpointId')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @Header('Cache-Control', 'no-store')
  public async updateWebhookEndpoint(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('endpointId', new ParseUUIDPipe({ version: '7' })) endpointId: string,
    @Body() body: UpdateWebhookEndpointDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const record = await this.webhookService.updateEndpoint(workspace.id, endpointId, body);

    return { data: toWebhookEndpointData(record) };
  }

  @Post('webhook-endpoints/:endpointId/secret/rotate')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @Header('Cache-Control', 'no-store')
  public async rotateWebhookSecret(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('endpointId', new ParseUUIDPipe({ version: '7' })) endpointId: string,
    @Body() body: VersionDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const result = await this.webhookService.rotateSecret(workspace.id, endpointId, body.version);

    return {
      data: {
        endpoint: toWebhookEndpointData(result.endpoint),
        secret: result.secret,
      },
    };
  }

  @Post('webhook-endpoints/:endpointId/enable')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @Header('Cache-Control', 'no-store')
  public async enableWebhookEndpoint(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('endpointId', new ParseUUIDPipe({ version: '7' })) endpointId: string,
    @Body() body: VersionDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const record = await this.webhookService.enableEndpoint(workspace.id, endpointId, body.version);

    return { data: toWebhookEndpointData(record) };
  }

  @Post('webhook-endpoints/:endpointId/disable')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @Header('Cache-Control', 'no-store')
  public async disableWebhookEndpoint(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('endpointId', new ParseUUIDPipe({ version: '7' })) endpointId: string,
    @Body() body: VersionDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const record = await this.webhookService.disableEndpoint(
      workspace.id,
      endpointId,
      body.version,
    );

    return { data: toWebhookEndpointData(record) };
  }

  @Get('webhook-deliveries')
  @UseGuards(...READ_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_READ)
  @Header('Cache-Control', 'no-store')
  public async listWebhookDeliveries(
    @Req() request: AdminWorkspaceHttpRequest,
    @Query() query: WebhookDeliveryListQueryDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const records = await this.webhookService.listDeliveries(workspace.id, {
      endpointId: query.endpointId,
      status: query.status,
      limit: query.limit ? Number(query.limit) : undefined,
    });

    return { data: { items: records.map(toWebhookDeliveryData) } };
  }

  @Post('webhook-deliveries/:deliveryId/retry')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.SITES_MANAGE)
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  public async retryWebhookDelivery(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('deliveryId', new ParseUUIDPipe({ version: '7' })) deliveryId: string,
  ) {
    const workspace = requireAdminWorkspace(request);
    const result = await this.webhookService.retryDelivery(workspace.id, deliveryId);

    return { data: result };
  }

  @Get('publication-schedules')
  @UseGuards(...READ_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENTS_READ)
  @Header('Cache-Control', 'no-store')
  public async listPublicationSchedules(
    @Req() request: AdminWorkspaceHttpRequest,
    @Query() query: PublicationScheduleListQueryDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const records = await this.schedulingService.list(workspace.id, {
      contentId: query.contentId,
      contentSiteId: query.contentSiteId,
      limit: query.limit ? Number(query.limit) : undefined,
    });

    return { data: { items: records.map(toPublicationScheduleData) } };
  }

  @Post('contents/:contentId/sites/:contentSiteId/schedules')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENT_PUBLISH)
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  public async createPublicationSchedule(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('contentId', new ParseUUIDPipe({ version: '7' })) contentId: string,
    @Param('contentSiteId', new ParseUUIDPipe({ version: '7' })) contentSiteId: string,
    @Body() body: CreatePublicationScheduleDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const record = await this.schedulingService.create(
      workspace.id,
      contentId,
      contentSiteId,
      body,
    );

    return { data: toPublicationScheduleData(record) };
  }

  @Post('publication-schedules/:scheduleId/cancel')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENT_PUBLISH)
  @Header('Cache-Control', 'no-store')
  public async cancelPublicationSchedule(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('scheduleId', new ParseUUIDPipe({ version: '7' })) scheduleId: string,
    @Body() body: VersionDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const record = await this.schedulingService.cancel(workspace.id, scheduleId, body.version);

    return { data: toPublicationScheduleData(record) };
  }

  @Post('publication-schedules/:scheduleId/retry')
  @UseGuards(...WRITE_GUARDS)
  @RequireAdminPermission(AdminPermission.CONTENT_PUBLISH)
  @Header('Cache-Control', 'no-store')
  public async retryPublicationSchedule(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('scheduleId', new ParseUUIDPipe({ version: '7' })) scheduleId: string,
    @Body() body: VersionDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const record = await this.schedulingService.retry(workspace.id, scheduleId, body.version);

    return { data: toPublicationScheduleData(record) };
  }
}

function toOutboxData(record: Readonly<OutboxEventRecord>) {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    siteId: record.siteId ?? null,
    aggregateType: record.aggregateType,
    aggregateId: record.aggregateId,
    eventType: record.eventType,
    schemaVersion: record.schemaVersion,
    status: record.status,
    availableAt: record.availableAt.toISOString(),
    claimedAt: record.claimedAt?.toISOString() ?? null,
    dispatchedAt: record.dispatchedAt?.toISOString() ?? null,
    attemptCount: record.attemptCount,
    lastError: record.lastError ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toWebhookEndpointData(record: Readonly<WebhookEndpointView>) {
  return {
    ...record,
    disabledAt: record.disabledAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toWebhookDeliveryData(record: Readonly<WebhookDeliveryView>) {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    endpointId: record.endpointId,
    endpointName: record.endpointName,
    endpointUrl: record.endpointUrl,
    siteId: record.siteId,
    eventId: record.eventId,
    eventType: record.eventType,
    status: record.status,
    attemptCount: record.attemptCount,
    nextRetryAt: record.nextRetryAt?.toISOString() ?? null,
    lastResponseStatus: record.lastResponseStatus ?? null,
    lastResponseExcerpt: record.lastResponseExcerpt ?? null,
    lastError: record.lastError ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    attempts: record.attempts.map((attempt) => ({
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      responseStatus: attempt.responseStatus ?? null,
      responseBodyExcerpt: attempt.responseBodyExcerpt ?? null,
      errorMessage: attempt.errorMessage ?? null,
      requestedAt: attempt.requestedAt.toISOString(),
      completedAt: attempt.completedAt?.toISOString() ?? null,
    })),
  };
}

function toPublicationScheduleData(record: Readonly<PublicationScheduleRecord>) {
  return {
    ...record,
    scheduledFor: record.scheduledFor.toISOString(),
    nextAttemptAt: record.nextAttemptAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
    cancelledAt: record.cancelledAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
