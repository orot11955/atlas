import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  CONTENT_SITE_VISIBILITIES,
  CONTENT_TYPES,
  type ContentSiteVisibility,
  type ContentType,
} from '@atlas/server';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export class CreateContentSiteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('7')
  public siteId!: string;

  @ApiProperty({ minLength: 1, maxLength: 160, pattern: SLUG_PATTERN.source })
  @IsString()
  @Length(1, 160)
  @Matches(SLUG_PATTERN)
  public slug!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  public titleOverride?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public summaryOverride?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  public seo?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: CONTENT_SITE_VISIBILITIES, default: 'public' })
  @IsOptional()
  @IsIn([...CONTENT_SITE_VISIBILITIES])
  public visibility?: ContentSiteVisibility;
}

export class UpdateContentSiteDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  public version!: number;

  @ApiProperty({ minLength: 1, maxLength: 160, pattern: SLUG_PATTERN.source })
  @IsString()
  @Length(1, 160)
  @Matches(SLUG_PATTERN)
  public slug!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  public titleOverride?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public summaryOverride?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  public seo?: Record<string, unknown>;

  @ApiProperty({ enum: CONTENT_SITE_VISIBILITIES })
  @IsIn([...CONTENT_SITE_VISIBILITIES])
  public visibility!: ContentSiteVisibility;
}

export class DeliveryContentListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @IsString()
  @Length(1, 3)
  public limit?: string;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  public cursor?: string;

  @ApiPropertyOptional({ enum: CONTENT_TYPES })
  @IsOptional()
  @IsIn([...CONTENT_TYPES])
  public type?: ContentType;
}
