import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  DEPLOYMENT_STATUSES,
  ENVIRONMENT_TIERS,
  PROJECT_STATUSES,
  REPOSITORY_PROVIDERS,
  SERVICE_TYPES,
  type DeploymentStatus,
  type EnvironmentTier,
  type ProjectStatus,
  type RepositoryProvider,
  type ServiceType,
} from '@atlas/server';

export class ProjectListQueryDto {
  @ApiPropertyOptional({ enum: PROJECT_STATUSES })
  @IsOptional()
  @IsIn([...PROJECT_STATUSES])
  public status?: ProjectStatus;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  public search?: string;
}

export class CreateProjectDto {
  @ApiProperty({ minLength: 2, maxLength: 64, example: 'atlas' })
  @IsString()
  @Length(2, 64)
  public key!: string;

  @ApiProperty({ minLength: 1, maxLength: 120, example: 'Atlas' })
  @IsString()
  @Length(1, 120)
  public name!: string;

  @ApiPropertyOptional({ maxLength: 1_000 })
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  public description?: string;

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('7', { each: true })
  public siteIds!: string[];
}

export class UpdateProjectDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  public version!: number;

  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString()
  @Length(1, 120)
  public name!: string;

  @ApiPropertyOptional({ maxLength: 1_000 })
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  public description?: string;

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('7', { each: true })
  public siteIds!: string[];
}

export class ProjectStatusDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  public version!: number;
}

export class CreateRepositoryConnectionDto {
  @ApiProperty({ enum: REPOSITORY_PROVIDERS })
  @IsIn([...REPOSITORY_PROVIDERS])
  public provider!: RepositoryProvider;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @Length(1, 500)
  public repositoryUrl!: string;

  @ApiPropertyOptional({ maxLength: 240 })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  public repositoryFullName?: string;

  @ApiProperty({ maxLength: 240, example: 'develop' })
  @IsString()
  @Length(1, 240)
  public defaultBranch!: string;

  @ApiPropertyOptional({ maxLength: 240 })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  public externalId?: string;
}

export class CreateEnvironmentDto {
  @ApiProperty({ minLength: 2, maxLength: 64, example: 'production' })
  @IsString()
  @Length(2, 64)
  public key!: string;

  @ApiProperty({ minLength: 1, maxLength: 120, example: 'Production' })
  @IsString()
  @Length(1, 120)
  public name!: string;

  @ApiProperty({ enum: ENVIRONMENT_TIERS })
  @IsIn([...ENVIRONMENT_TIERS])
  public tier!: EnvironmentTier;
}

export class CreateServiceDto {
  @ApiProperty({ minLength: 2, maxLength: 64, example: 'web' })
  @IsString()
  @Length(2, 64)
  public key!: string;

  @ApiProperty({ minLength: 1, maxLength: 120, example: 'Admin Web' })
  @IsString()
  @Length(1, 120)
  public name!: string;

  @ApiProperty({ enum: SERVICE_TYPES })
  @IsIn([...SERVICE_TYPES])
  public type!: ServiceType;
}

export class ConnectServiceEnvironmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('7')
  public environmentId!: string;

  @ApiPropertyOptional({ maxLength: 500, example: 'https://example.com/health' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public healthUrl?: string;

  @ApiPropertyOptional({ minimum: 500, maximum: 60_000, default: 5_000 })
  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(60_000)
  public healthTimeoutMs?: number;
}

export class DeploymentListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('7')
  public projectId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('7')
  public environmentId?: string;

  @ApiPropertyOptional({ enum: DEPLOYMENT_STATUSES })
  @IsOptional()
  @IsIn([...DEPLOYMENT_STATUSES])
  public status?: DeploymentStatus;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @IsString()
  public limit?: string;
}

export class CreateReleaseCallbackDto {
  @ApiProperty({ minLength: 1, maxLength: 120, example: 'v1.4.0' })
  @IsString()
  @Length(1, 120)
  public version!: string;

  @ApiProperty({ minLength: 7, maxLength: 64 })
  @IsString()
  @Length(7, 64)
  public commitSha!: string;

  @ApiPropertyOptional({ maxLength: 240 })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  public sourceRef?: string;

  @ApiPropertyOptional({ maxLength: 240 })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  public externalId?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;
}

export class StartDeploymentCallbackDto {
  @ApiProperty({ minLength: 2, maxLength: 64 })
  @IsString()
  @Length(2, 64)
  public serviceKey!: string;

  @ApiProperty({ minLength: 2, maxLength: 64 })
  @IsString()
  @Length(2, 64)
  public environmentKey!: string;

  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString()
  @Length(1, 120)
  public releaseVersion!: string;

  @ApiPropertyOptional({ maxLength: 240 })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  public externalId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  public startedAt?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;
}

export class DeploymentEventCallbackDto {
  @ApiPropertyOptional({ maxLength: 240 })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  public externalEventId?: string;

  @ApiProperty({ maxLength: 120, example: 'build.completed' })
  @IsString()
  @Length(1, 120)
  public type!: string;

  @ApiPropertyOptional({ enum: DEPLOYMENT_STATUSES })
  @IsOptional()
  @IsIn([...DEPLOYMENT_STATUSES])
  public status?: DeploymentStatus;

  @ApiPropertyOptional({ maxLength: 2_000 })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public message?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  public occurredAt?: string;
}

export class CompleteDeploymentCallbackDto {
  @ApiProperty({ enum: ['succeeded', 'failed', 'cancelled'] })
  @IsIn(['succeeded', 'failed', 'cancelled'])
  public status!: DeploymentStatus;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  public failureCode?: string;

  @ApiPropertyOptional({ maxLength: 2_000 })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public failureMessage?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  public completedAt?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;
}

export class HealthCallbackDto {
  @ApiProperty({ enum: ['healthy', 'unhealthy', 'unknown'] })
  @IsIn(['healthy', 'unhealthy', 'unknown'])
  public status!: 'healthy' | 'unhealthy' | 'unknown';

  @ApiPropertyOptional({ minimum: 100, maximum: 599 })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(599)
  public httpStatus?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 3_600_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3_600_000)
  public latencyMs?: number;

  @ApiPropertyOptional({ maxLength: 2_000 })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public message?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  public checkedAt?: string;
}
