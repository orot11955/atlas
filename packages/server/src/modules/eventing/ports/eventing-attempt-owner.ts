/** Identity captured at claim time. Attempts never reset, including manual retries. */
export interface OutboxAttemptOwner {
  eventId: string;
  workspaceId: string;
  attemptNumber: number;
}

export interface EventConsumptionOwner extends OutboxAttemptOwner {
  consumptionId: string;
  consumerKey: string;
}

export interface WebhookAttemptOwner {
  deliveryId: string;
  workspaceId: string;
  endpointId: string;
  attemptId: string;
  attemptNumber: number;
  /** Endpoint configuration observed before HTTP; old configuration cannot change new counters. */
  endpointVersion: number;
}

export interface FinishWebhookExecutionInput {
  status: 'succeeded' | 'dead' | 'retry_scheduled';
  responseStatus?: number;
  responseBodyExcerpt?: string;
  errorMessage?: string;
  nextRetryAt?: Date;
  finishedAt: Date;
  endpointFailureThreshold: number;
}
