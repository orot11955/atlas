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
  ProjectStatus,
  type ProjectDeploymentAdministrationService,
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
  ConnectServiceEnvironmentDto,
  CreateEnvironmentDto,
  CreateProjectDto,
  CreateRepositoryConnectionDto,
  CreateServiceDto,
  DeploymentListQueryDto,
  ProjectListQueryDto,
  ProjectStatusDto,
  UpdateProjectDto,
} from './dto/project-deployment.dto';
import {
  toDeploymentData,
  toDeploymentDetailData,
  toEnvironmentData,
  toProjectData,
  toProjectDetailData,
  toRepositoryData,
  toServiceData,
  toServiceEnvironmentData,
} from './project-deployment.presenter';
import { PROJECT_DEPLOYMENT_ADMINISTRATION_SERVICE } from './project-deployment.tokens';

@ApiTags('Admin Projects and Deployments')
@Controller('admin/v1')
export class AdminProjectDeploymentController {
  public constructor(
    @Inject(PROJECT_DEPLOYMENT_ADMINISTRATION_SERVICE)
    private readonly service: ProjectDeploymentAdministrationService<unknown>,
  ) {}

  @Get('projects')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.PROJECTS_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Returns Workspace-scoped Projects.' })
  public async listProjects(
    @Req() request: AdminWorkspaceHttpRequest,
    @Query() query: ProjectListQueryDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const projects = await this.service.listProjects(workspace.id, query);
    return { data: projects.map(toProjectData) };
  }

  @Post('projects')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.PROJECTS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({ description: 'Creates an active Project.' })
  public async createProject(
    @Req() request: AdminWorkspaceHttpRequest,
    @Body() body: CreateProjectDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const project = await this.service.createProject(workspace.id, body);
    return { data: toProjectData(project) };
  }

  @Get('projects/:projectId')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.PROJECTS_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Returns Project configuration and Timeline.' })
  public async getProject(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('projectId', new ParseUUIDPipe({ version: '7' })) projectId: string,
  ) {
    const workspace = requireAdminWorkspace(request);
    const detail = await this.service.getProject(workspace.id, projectId);
    return { data: toProjectDetailData(detail) };
  }

  @Patch('projects/:projectId')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.PROJECTS_MANAGE)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Updates a mutable Project.' })
  public async updateProject(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('projectId', new ParseUUIDPipe({ version: '7' })) projectId: string,
    @Body() body: UpdateProjectDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const project = await this.service.updateProject(workspace.id, projectId, body);
    return { data: toProjectData(project) };
  }

  @Post('projects/:projectId/activate')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.PROJECTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  public activateProject(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('projectId', new ParseUUIDPipe({ version: '7' })) projectId: string,
    @Body() body: ProjectStatusDto,
  ) {
    return this.transitionProject(request, projectId, ProjectStatus.ACTIVE, body.version);
  }

  @Post('projects/:projectId/pause')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.PROJECTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  public pauseProject(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('projectId', new ParseUUIDPipe({ version: '7' })) projectId: string,
    @Body() body: ProjectStatusDto,
  ) {
    return this.transitionProject(request, projectId, ProjectStatus.PAUSED, body.version);
  }

  @Post('projects/:projectId/archive')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.PROJECTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  public archiveProject(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('projectId', new ParseUUIDPipe({ version: '7' })) projectId: string,
    @Body() body: ProjectStatusDto,
  ) {
    return this.transitionProject(request, projectId, ProjectStatus.ARCHIVED, body.version);
  }

  @Post('projects/:projectId/repositories')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.PROJECTS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  public async connectRepository(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('projectId', new ParseUUIDPipe({ version: '7' })) projectId: string,
    @Body() body: CreateRepositoryConnectionDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const connection = await this.service.addRepositoryConnection(workspace.id, projectId, body);
    return { data: toRepositoryData(connection) };
  }

  @Get('environments')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.PROJECTS_READ)
  @Header('Cache-Control', 'no-store')
  public async listEnvironments(@Req() request: AdminWorkspaceHttpRequest) {
    const workspace = requireAdminWorkspace(request);
    const environments = await this.service.listEnvironments(workspace.id);
    return { data: environments.map(toEnvironmentData) };
  }

  @Post('environments')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.PROJECTS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  public async createEnvironment(
    @Req() request: AdminWorkspaceHttpRequest,
    @Body() body: CreateEnvironmentDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const environment = await this.service.createEnvironment(workspace.id, body);
    return { data: toEnvironmentData(environment) };
  }

  @Post('projects/:projectId/services')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.PROJECTS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  public async createService(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('projectId', new ParseUUIDPipe({ version: '7' })) projectId: string,
    @Body() body: CreateServiceDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const service = await this.service.addService(workspace.id, projectId, body);
    return { data: toServiceData(service) };
  }

  @Post('projects/:projectId/services/:serviceId/environments')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminCsrfGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.PROJECTS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  public async connectServiceEnvironment(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('projectId', new ParseUUIDPipe({ version: '7' })) projectId: string,
    @Param('serviceId', new ParseUUIDPipe({ version: '7' })) serviceId: string,
    @Body() body: ConnectServiceEnvironmentDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const record = await this.service.connectServiceEnvironment(
      workspace.id,
      projectId,
      serviceId,
      body,
    );
    return { data: toServiceEnvironmentData(record) };
  }

  @Get('deployments')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.DEPLOYMENTS_READ)
  @Header('Cache-Control', 'no-store')
  public async listDeployments(
    @Req() request: AdminWorkspaceHttpRequest,
    @Query() query: DeploymentListQueryDto,
  ) {
    const workspace = requireAdminWorkspace(request);
    const deployments = await this.service.listDeployments(workspace.id, {
      projectId: query.projectId,
      environmentId: query.environmentId,
      status: query.status,
      limit: query.limit ? Number(query.limit) : undefined,
    });
    return { data: deployments.map(toDeploymentData) };
  }

  @Get('deployments/:deploymentId')
  @UseGuards(AdminSessionGuard, AdminWorkspaceGuard, AdminPermissionGuard)
  @RequireAdminPermission(AdminPermission.DEPLOYMENTS_READ)
  @Header('Cache-Control', 'no-store')
  public async getDeployment(
    @Req() request: AdminWorkspaceHttpRequest,
    @Param('deploymentId', new ParseUUIDPipe({ version: '7' })) deploymentId: string,
  ) {
    const workspace = requireAdminWorkspace(request);
    const detail = await this.service.getDeployment(workspace.id, deploymentId);
    return { data: toDeploymentDetailData(detail) };
  }

  private async transitionProject(
    request: AdminWorkspaceHttpRequest,
    projectId: string,
    status: ProjectStatus,
    version: number,
  ) {
    const workspace = requireAdminWorkspace(request);
    const project = await this.service.changeProjectStatus(
      workspace.id,
      projectId,
      status,
      version,
    );
    return { data: toProjectData(project) };
  }
}
