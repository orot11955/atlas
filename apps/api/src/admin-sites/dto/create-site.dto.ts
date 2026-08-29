import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsLocale,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

import { SITE_TYPES, type SiteType } from '@atlas/server';

export class CreateSiteDto {
  @ApiProperty({ example: 'main-blog', minLength: 2, maxLength: 64 })
  @IsString()
  @Length(2, 64)
  public key!: string;

  @ApiProperty({ example: 'Main Blog', minLength: 1, maxLength: 120 })
  @IsString()
  @Length(1, 120)
  public name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public description?: string;

  @ApiProperty({ enum: SITE_TYPES, example: 'blog' })
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
