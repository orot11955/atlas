import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  CONTENT_STATUSES,
  CONTENT_TYPES,
  type ContentStatus,
  type ContentType,
} from '@atlas/server';

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
