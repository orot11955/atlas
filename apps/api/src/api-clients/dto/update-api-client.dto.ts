import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { API_CLIENT_SCOPES, type ApiClientScope } from '@atlas/server';

export class UpdateApiClientDto {
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

  @ApiProperty({ minimum: 1, maximum: 100000 })
  @IsInt()
  @Min(1)
  @Max(100_000)
  public rateLimitPerMinute!: number;

  @ApiProperty()
  @IsBoolean()
  public requireOrigin!: boolean;

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

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(512, { each: true })
  public allowedOrigins!: string[];
}
