import type { PublicationScheduleEffectReceipt } from '../domain/scheduled-publication';

export interface PublicationScheduleEffectRepositoryPort<TTransaction> {
  find(
    scheduleId: string,
    workspaceId: string,
    transaction: TTransaction,
  ): Promise<Readonly<PublicationScheduleEffectReceipt> | undefined>;
  insert(
    receipt: Readonly<PublicationScheduleEffectReceipt>,
    transaction: TTransaction,
  ): Promise<void>;
}
