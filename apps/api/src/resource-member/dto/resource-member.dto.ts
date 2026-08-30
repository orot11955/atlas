import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  MEMBER_STATUSES,
  RESOURCE_SENSITIVITIES,
  RESOURCE_STATUSES,
  RESOURCE_TYPES,
  RESOURCE_VISIBILITIES,
  SITE_MEMBERSHIP_STATUSES,
  type MemberStatus,
  type ResourceSensitivity,
  type ResourceStatus,
  type ResourceType,
  type ResourceVisibility,
  type SiteMembershipStatus,
} from '@atlas/server';

export class CreateResourceCollectionDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  public parentId?: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @Length(1, 120)
  public name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public description?: string;
}

export class UpdateResourceCollectionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  public version!: number;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @Length(1, 120)
  public name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public description?: string;
}

export class VersionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  public version!: number;
}

export class ResourceListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  @Max(200)
  public limit?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  public collectionId?: string;

  @ApiPropertyOptional({ enum: RESOURCE_TYPES })
  @IsOptional()
  @IsIn([...RESOURCE_TYPES])
  public type?: ResourceType;

  @ApiPropertyOptional({ enum: RESOURCE_STATUSES })
  @IsOptional()
  @IsIn([...RESOURCE_STATUSES])
  public status?: ResourceStatus;

  @ApiPropertyOptional({ enum: RESOURCE_VISIBILITIES })
  @IsOptional()
  @IsIn([...RESOURCE_VISIBILITIES])
  public visibility?: ResourceVisibility;

  @ApiPropertyOptional({ enum: RESOURCE_SENSITIVITIES })
  @IsOptional()
  @IsIn([...RESOURCE_SENSITIVITIES])
  public sensitivity?: ResourceSensitivity;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  public tag?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  public projectId?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  public search?: string;
}

export class CreateResourceDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  public collectionId?: string;

  @ApiProperty({ enum: RESOURCE_TYPES })
  @IsIn([...RESOURCE_TYPES])
  public type!: ResourceType;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @Length(1, 200)
  public title!: string;

  @ApiPropertyOptional({ maxLength: 1_000 })
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  public summary?: string;

  @ApiPropertyOptional({ maxLength: 200_000 })
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  public bodyMarkdown?: string;

  @ApiPropertyOptional({ maxLength: 2_000 })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public sourceUrl?: string;

  @ApiPropertyOptional({ enum: RESOURCE_VISIBILITIES })
  @IsOptional()
  @IsIn([...RESOURCE_VISIBILITIES])
  public visibility?: ResourceVisibility;

  @ApiPropertyOptional({ enum: RESOURCE_SENSITIVITIES })
  @IsOptional()
  @IsIn([...RESOURCE_SENSITIVITIES])
  public sensitivity?: ResourceSensitivity;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  public secretReference?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  public tags?: string[];

  @ApiPropertyOptional({ type: [String], maxItems: 100 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  public projectIds?: string[];
}

export class UpdateResourceDto extends CreateResourceDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  public version!: number;
}

export class MemberMembershipInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  public siteId!: string;

  @ApiPropertyOptional({ enum: SITE_MEMBERSHIP_STATUSES })
  @IsOptional()
  @IsIn([...SITE_MEMBERSHIP_STATUSES])
  public status?: SiteMembershipStatus;
}

export class CreateMemberDto {
  @ApiPropertyOptional({ maxLength: 320 })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  public email?: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @Length(1, 120)
  public displayName!: string;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  public externalProvider?: string;

  @ApiPropertyOptional({ maxLength: 240 })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  public externalSubject?: string;

  @ApiPropertyOptional({ type: [MemberMembershipInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MemberMembershipInputDto)
  public memberships?: MemberMembershipInputDto[];
}

export class UpdateMemberDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  public version!: number;

  @ApiPropertyOptional({ maxLength: 320 })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  public email?: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @Length(1, 120)
  public displayName!: string;
}

export class MemberListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  @Max(200)
  public limit?: number;

  @ApiPropertyOptional({ enum: MEMBER_STATUSES })
  @IsOptional()
  @IsIn([...MEMBER_STATUSES])
  public status?: MemberStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  public siteId?: string;

  @ApiPropertyOptional({ enum: SITE_MEMBERSHIP_STATUSES })
  @IsOptional()
  @IsIn([...SITE_MEMBERSHIP_STATUSES])
  public membershipStatus?: SiteMembershipStatus;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  public search?: string;
}

export class MembershipStatusDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  public version!: number;

  @ApiProperty({ enum: SITE_MEMBERSHIP_STATUSES })
  @IsIn([...SITE_MEMBERSHIP_STATUSES])
  public status!: SiteMembershipStatus;
}

export class MemberNoteDto {
  @ApiProperty({ minLength: 1, maxLength: 2_000 })
  @IsString()
  @Length(1, 2_000)
  public body!: string;
}
