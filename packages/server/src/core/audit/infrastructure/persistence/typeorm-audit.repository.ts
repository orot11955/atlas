import type { DataSource, EntityManager } from 'typeorm';

import type { AuditRecord } from '../../audit-record';
import type { AuditRepositoryPort } from '../../audit-repository.port';
import { AuditLogEntity } from './audit-log.entity';

export class TypeOrmAuditRepository implements AuditRepositoryPort<EntityManager> {
  public constructor(private readonly dataSource: DataSource) {}

  public async insert(record: AuditRecord, transaction?: EntityManager): Promise<void> {
    const manager = transaction ?? this.dataSource.manager;
    const repository = manager.getRepository(AuditLogEntity);

    await repository.insert({
      id: record.id,
      workspaceId: record.workspaceId ?? null,
      siteId: record.siteId ?? null,
      actorType: record.actorType,
      actorId: record.actorId ?? null,
      action: record.action,
      targetType: record.targetType,
      targetId: record.targetId ?? null,
      requestId: record.requestId,
      traceId: record.traceId,
      correlationId: record.correlationId ?? null,
      result: record.result,
      errorCode: record.errorCode ?? null,
      metadata: { ...record.metadata },
      occurredAt: record.occurredAt,
    });
  }
}
