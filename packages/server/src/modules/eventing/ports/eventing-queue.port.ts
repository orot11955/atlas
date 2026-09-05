export const OUTBOX_CONSUME_JOB_NAME = 'outbox.consume';
export const WEBHOOK_DELIVERY_JOB_NAME = 'webhook.deliver';
export const PUBLICATION_SCHEDULE_JOB_NAME = 'publication.schedule';

export interface EnqueueOutboxEventInput {
  eventId: string;
  availableAt: Date;
  correlationId?: string;
}

export interface EnqueueWebhookDeliveryInput {
  deliveryId: string;
  attemptNumber: number;
  availableAt: Date;
  correlationId?: string;
}

export interface EnqueuePublicationScheduleInput {
  scheduleId: string;
  attemptNumber: number;
  availableAt: Date;
  correlationId?: string;
}

export interface EventingQueuePort {
  enqueueOutboxEvent(input: Readonly<EnqueueOutboxEventInput>): Promise<void>;
  enqueueWebhookDelivery(input: Readonly<EnqueueWebhookDeliveryInput>): Promise<void>;
  enqueuePublicationSchedule(input: Readonly<EnqueuePublicationScheduleInput>): Promise<void>;
}
