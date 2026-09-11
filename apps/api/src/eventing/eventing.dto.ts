import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

import {
  OutboxEventStatus,
  PublicationScheduleAction,
  WEBHOOK_EVENT_TYPES,
  WebhookDeliveryStatus,
  type OutboxEventStatus as OutboxEventStatusValue,
  type PublicationScheduleAction as PublicationScheduleActionValue,
  type WebhookDeliveryStatus as WebhookDeliveryStatusValue,
} from '@atlas/server';

export class EventingListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 100 })
  @IsOptional()
  @IsString()
  @Matches(/^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|200)$/u)
  public limit?: string;
}

export class OutboxListQueryDto extends EventingListQueryDto {
  @ApiPropertyOptional({ enum: Object.values(OutboxEventStatus) })
  @IsOptional()
  @IsIn(Object.values(OutboxEventStatus))
  public status?: OutboxEventStatusValue;
}

export class WebhookEndpointListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('7')
  public siteId?: string;
}

export class CreateWebhookEndpointDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('7')
  public siteId!: string;

  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString()
  @Length(1, 120)
  public name!: string;

  @ApiProperty({ format: 'uri', maxLength: 2048 })
  @IsString()
  @Length(8, 2048)
  public url!: string;

  @ApiProperty({ enum: WEBHOOK_EVENT_TYPES, isArray: true })
  @IsArray()
  @IsString({ each: true })
  @IsIn([...WEBHOOK_EVENT_TYPES], { each: true })
  public subscribedEvents!: string[];
}

export class UpdateWebhookEndpointDto {
  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString()
  @Length(1, 120)
  public name!: string;

  @ApiProperty({ format: 'uri', maxLength: 2048 })
  @IsString()
  @Length(8, 2048)
  public url!: string;

  @ApiProperty({ enum: WEBHOOK_EVENT_TYPES, isArray: true })
  @IsArray()
  @IsString({ each: true })
  @IsIn([...WEBHOOK_EVENT_TYPES], { each: true })
  public subscribedEvents!: string[];

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  public version!: number;
}

export class VersionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  public version!: number;
}

export class WebhookDeliveryListQueryDto extends EventingListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('7')
  public endpointId?: string;

  @ApiPropertyOptional({ enum: Object.values(WebhookDeliveryStatus) })
  @IsOptional()
  @IsIn(Object.values(WebhookDeliveryStatus))
  public status?: WebhookDeliveryStatusValue;
}

export class PublicationScheduleListQueryDto extends EventingListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('7')
  public contentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('7')
  public contentSiteId?: string;
}

export class CreatePublicationScheduleDto {
  @ApiProperty({ enum: Object.values(PublicationScheduleAction) })
  @IsIn(Object.values(PublicationScheduleAction))
  public action!: PublicationScheduleActionValue;

  @ApiProperty({ example: '2026-09-05T09:30:00' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/u)
  public scheduledLocalAt!: string;

  @ApiPropertyOptional({ example: 'Asia/Seoul', maxLength: 64 })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  public timezone?: string;
}
