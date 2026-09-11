import type { OutboxEventRecord } from '../domain/eventing';

export interface RecordOutboxEventInput {
  workspaceId: string;
  siteId?: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  data?: Readonly<Record<string, unknown>>;
  availableAt?: Date;
}

export interface OutboxRecorderPort<TTransaction> {
  record(
    input: Readonly<RecordOutboxEventInput>,
    transaction: TTransaction,
  ): Promise<Readonly<OutboxEventRecord>>;
}
