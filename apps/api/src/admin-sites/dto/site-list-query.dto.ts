import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { SITE_STATUSES, SITE_TYPES, type SiteStatus, type SiteType } from '@atlas/server';

export class SiteListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Matches(/^\d{1,3}$/u)
  public limit?: string;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  public cursor?: string;

  @ApiPropertyOptional({ enum: SITE_STATUSES })
  @IsOptional()
  @IsIn([...SITE_STATUSES])
  public status?: SiteStatus;

  @ApiPropertyOptional({ enum: SITE_TYPES })
  @IsOptional()
  @IsIn([...SITE_TYPES])
  public type?: SiteType;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  public search?: string;
}
