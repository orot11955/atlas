import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import {
  ApiClientScope,
  ApiClientType,
  DomainError,
  ErrorCode,
  type DeploymentCallbackService,
} from '@atlas/server';

import {
  ApiClientAuthenticationGuard,
  RequireApiClientAccess,
  requireApiClientPrincipal,
} from '../api-clients/api-client-auth.guard';
import {
  readSingleApiClientHeader,
  type ApiClientHttpRequest,
} from '../api-clients/api-client.request';
import {
  CompleteDeploymentCallbackDto,
  CreateReleaseCallbackDto,
  DeploymentEventCallbackDto,
  HealthCallbackDto,
  StartDeploymentCallbackDto,
} from './dto/project-deployment.dto';
import {
  toDeploymentData,
  toDeploymentEventData,
  toHealthCheckData,
  toReleaseData,
} from './project-deployment.presenter';
import { DEPLOYMENT_CALLBACK_SERVICE } from './project-deployment.tokens';

interface PassthroughResponse {
  setHeader(name: string, value: string): void;
}

@ApiTags('CI Deployment Callbacks')
@Controller('integration/v1')
@UseGuards(ApiClientAuthenticationGuard)
export class IntegrationDeploymentController {
  public constructor(
    @Inject(DEPLOYMENT_CALLBACK_SERVICE)
    private readonly service: DeploymentCallbackService<unknown>,
  ) {}

  @Post('projects/:projectKey/releases')
  @Header('Cache-Control', 'no-store')
  @RequireApiClientAccess({
    type: ApiClientType.INTEGRATION,
    scope: ApiClientScope.RELEASE_WRITE,
    siteParam: false,
  })
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Creates or reuses a Project Release.' })
  public async createRelease(
    @Req() request: ApiClientHttpRequest,
    @Param('projectKey') projectKey: string,
    @Body() body: CreateReleaseCallbackDto,
  ) {
    const principal = requireApiClientPrincipal(request);
    const release = await this.service.createRelease(principal, projectKey, body);
    return { data: toReleaseData(release) };
  }

  @Post('projects/:projectKey/deployments')
  @Header('Cache-Control', 'no-store')
  @RequireApiClientAccess({
    type: ApiClientType.INTEGRATION,
    scope: ApiClientScope.DEPLOYMENT_CREATE,
    siteParam: false,
  })
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Starts one idempotent Deployment.' })
  public async startDeployment(
    @Req() request: ApiClientHttpRequest,
    @Res({ passthrough: true }) response: PassthroughResponse,
    @Param('projectKey') projectKey: string,
    @Body() body: StartDeploymentCallbackDto,
  ) {
    const principal = requireApiClientPrincipal(request);
    const idempotencyKey = readSingleApiClientHeader(request.headers['idempotency-key']);

    if (!idempotencyKey) {
      throw new DomainError({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Idempotency-Key header is required.',
        details: { field: 'Idempotency-Key' },
      });
    }

    const result = await this.service.startDeployment(principal, projectKey, idempotencyKey, {
      ...body,
      startedAt: body.startedAt ? new Date(body.startedAt) : undefined,
    });
    response.setHeader('Idempotent-Replayed', result.replayed ? 'true' : 'false');
    return { data: toDeploymentData(result.deployment) };
  }

  @Post('deployments/:deploymentId/events')
  @Header('Cache-Control', 'no-store')
  @RequireApiClientAccess({
    type: ApiClientType.INTEGRATION,
    scope: ApiClientScope.DEPLOYMENT_UPDATE,
    siteParam: false,
  })
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Appends a Deployment Event.' })
  public async addEvent(
    @Req() request: ApiClientHttpRequest,
    @Param('deploymentId', new ParseUUIDPipe({ version: '7' })) deploymentId: string,
    @Body() body: DeploymentEventCallbackDto,
  ) {
    const principal = requireApiClientPrincipal(request);
    const event = await this.service.addDeploymentEvent(principal, deploymentId, {
      ...body,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
    });
    return { data: toDeploymentEventData(event) };
  }

  @Post('deployments/:deploymentId/complete')
  @Header('Cache-Control', 'no-store')
  @RequireApiClientAccess({
    type: ApiClientType.INTEGRATION,
    scope: ApiClientScope.DEPLOYMENT_UPDATE,
    siteParam: false,
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Completes a Deployment without executing remote commands.' })
  public async completeDeployment(
    @Req() request: ApiClientHttpRequest,
    @Param('deploymentId', new ParseUUIDPipe({ version: '7' })) deploymentId: string,
    @Body() body: CompleteDeploymentCallbackDto,
  ) {
    const principal = requireApiClientPrincipal(request);
    const deployment = await this.service.completeDeployment(principal, deploymentId, {
      ...body,
      completedAt: body.completedAt ? new Date(body.completedAt) : undefined,
    });
    return { data: toDeploymentData(deployment) };
  }

  @Post('deployments/:deploymentId/health')
  @Header('Cache-Control', 'no-store')
  @RequireApiClientAccess({
    type: ApiClientType.INTEGRATION,
    scope: ApiClientScope.HEALTH_WRITE,
    siteParam: false,
  })
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({
    description: 'Records a Health result for the pre-registered Service Environment target.',
  })
  public async recordHealth(
    @Req() request: ApiClientHttpRequest,
    @Param('deploymentId', new ParseUUIDPipe({ version: '7' })) deploymentId: string,
    @Body() body: HealthCallbackDto,
  ) {
    const principal = requireApiClientPrincipal(request);
    const health = await this.service.recordHealth(principal, deploymentId, {
      ...body,
      checkedAt: body.checkedAt ? new Date(body.checkedAt) : undefined,
    });
    return { data: toHealthCheckData(health) };
  }
}
