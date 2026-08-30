import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  API_CLIENT_SCOPES,
  API_CLIENT_TYPES,
  type ApiClientScope,
  type ApiClientType,
} from '@atlas/server';

export class CreateApiClientDto {
  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString()
  @Length(1, 120)
  public name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public description?: string;

  @ApiProperty({ enum: API_CLIENT_TYPES })
  @IsIn([...API_CLIENT_TYPES])
  public type!: ApiClientType;

  @ApiProperty({ minimum: 1, maximum: 100000, default: 600 })
  @IsInt()
  @Min(1)
  @Max(100_000)
  public rateLimitPerMinute = 600;

  @ApiProperty({ default: false })
  @IsBoolean()
  public requireOrigin = false;

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('7', { each: true })
  public siteIds!: string[];

  @ApiProperty({ enum: API_CLIENT_SCOPES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(API_CLIENT_SCOPES.length)
  @ArrayUnique()
  @IsIn([...API_CLIENT_SCOPES], { each: true })
  public scopes!: ApiClientScope[];

  @ApiPropertyOptional({ type: [String], default: [] })
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(512, { each: true })
  public allowedOrigins: string[] = [];

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  public expiresAt?: string;
}
