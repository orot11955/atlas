import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsInt, IsOptional, Max, Min } from 'class-validator';

export class RotateApiClientKeyDto {
  @ApiProperty({ minimum: 0, maximum: 604800, default: 3600 })
  @IsInt()
  @Min(0)
  @Max(604_800)
  public gracePeriodSeconds = 3_600;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  public expiresAt?: string;
}
