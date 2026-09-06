import type { DataSource, EntityManager } from 'typeorm';

import type { WebhookEndpointRecord, WebhookEventType } from '../../domain/eventing';
import { SafeTypeOrmEventingRepository } from './safe-typeorm-eventing.repository';

export class SubscriptionAwareTypeOrmEventingRepository extends SafeTypeOrmEventingRepository {
  public constructor(dataSource: DataSource) {
    super(dataSource);
  }

  public override async listActiveWebhookEndpointsForEvent(
    workspaceId: string,
    siteId: string,
    eventType: WebhookEventType,
    occurredAt?: Date,
    transaction?: EntityManager,
  ): Promise<readonly WebhookEndpointRecord[]> {
    const endpoints = await super.listActiveWebhookEndpointsForEvent(
      workspaceId,
      siteId,
      eventType,
      occurredAt,
      transaction,
    );

    if (!occurredAt) {
      return endpoints;
    }

    const cutoff = occurredAt.getTime();
    return endpoints.filter((endpoint) => endpoint.createdAt.getTime() <= cutoff);
  }
}
