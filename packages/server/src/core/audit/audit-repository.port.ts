import type { AuditRecord } from './audit-record';

export interface AuditRepositoryPort<TTransaction = unknown> {
  insert(record: AuditRecord, transaction?: TTransaction): Promise<void>;
}
