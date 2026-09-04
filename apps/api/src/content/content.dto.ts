import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  CONTENT_STATUSES,
  CONTENT_TYPES,
  type ContentStatus,
  type ContentType,
} from '@atlas/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class ContentCoverAssetDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  @Matches(UUID_PATTERN)
  public assetId!: string;

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @Length(1, 300)
  public altText!: string;

  @ApiPropertyOptional({ maxLength: 1_000 })
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  public caption?: string;
}

export class CreateContentDto {
  @ApiProperty({ enum: CONTENT_TYPES })
  @IsIn([...CONTENT_TYPES])
  public type!: ContentType;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  public title?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public summary?: string;

  @ApiPropertyOptional({ maxLength: 500_000 })
  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  public bodyMarkdown?: string;

  @ApiPropertyOptional({ type: () => ContentCoverAssetDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContentCoverAssetDto)
  public cover?: ContentCoverAssetDto | null;
}

export class SaveContentDraftDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  public draftVersion!: number;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  public title!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public summary?: string;

  @ApiProperty({ maxLength: 500_000 })
  @IsString()
  @MaxLength(500_000)
  public bodyMarkdown!: string;

  @ApiPropertyOptional({ type: () => ContentCoverAssetDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContentCoverAssetDto)
  public cover?: ContentCoverAssetDto | null;
}

export class PreviewContentDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  public title?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public summary?: string;

  @ApiProperty({ maxLength: 500_000 })
  @IsString()
  @MaxLength(500_000)
  public bodyMarkdown!: string;

  @ApiPropertyOptional({ type: () => ContentCoverAssetDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContentCoverAssetDto)
  public cover?: ContentCoverAssetDto | null;
}

export class CreateContentRevisionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  public contentVersion!: number;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  public draftVersion!: number;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  public note?: string;
}

export class RestoreContentRevisionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  public draftVersion!: number;
}

export class ArchiveContentDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  public contentVersion!: number;
}

export class ContentListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @IsString()
  @Length(1, 3)
  public limit?: string;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  public cursor?: string;

  @ApiPropertyOptional({ enum: CONTENT_STATUSES })
  @IsOptional()
  @IsIn([...CONTENT_STATUSES])
  public status?: ContentStatus;

  @ApiPropertyOptional({ enum: CONTENT_TYPES })
  @IsOptional()
  @IsIn([...CONTENT_TYPES])
  public type?: ContentType;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  public search?: string;
}
