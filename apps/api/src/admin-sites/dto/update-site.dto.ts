import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsLocale,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { SITE_TYPES, type SiteType } from '@atlas/server';

export class UpdateSiteDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  public version!: number;

  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString()
  @Length(1, 120)
  public name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public description?: string;

  @ApiProperty({ enum: SITE_TYPES })
  @IsIn([...SITE_TYPES])
  public type!: SiteType;

  @ApiProperty({ example: 'Asia/Seoul' })
  @IsString()
  @Length(1, 64)
  public timezone!: string;

  @ApiProperty({ example: 'ko-KR' })
  @IsLocale()
  public locale!: string;

  @ApiPropertyOptional({ example: 'blog.example.com', maxLength: 253 })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  public canonicalDomain?: string;
}
