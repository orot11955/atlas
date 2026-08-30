import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import {
  API_CLIENT_STATUSES,
  API_CLIENT_TYPES,
  type ApiClientStatus,
  type ApiClientType,
} from '@atlas/server';

export class ApiClientListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('7')
  public siteId?: string;

  @ApiPropertyOptional({ enum: API_CLIENT_STATUSES })
  @IsOptional()
  @IsIn([...API_CLIENT_STATUSES])
  public status?: ApiClientStatus;

  @ApiPropertyOptional({ enum: API_CLIENT_TYPES })
  @IsOptional()
  @IsIn([...API_CLIENT_TYPES])
  public type?: ApiClientType;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  public search?: string;
}
