import type { DataSource, EntityManager, Repository } from 'typeorm';

import type { WorkspaceRecord } from '../../domain/workspace';
import type {
  UpdateWorkspaceRecordInput,
  WorkspaceRepositoryPort,
} from '../../ports/workspace.repository';
import { WorkspaceEntity } from './workspace.entity';

export class TypeOrmWorkspaceRepository implements WorkspaceRepositoryPort<EntityManager> {
  public constructor(private readonly dataSource: DataSource) {}

  public async findDefault(transaction?: EntityManager): Promise<WorkspaceRecord | undefined> {
    const entity = await this.repository(transaction).findOne({
      where: { isDefault: true },
    });

    return entity ? toWorkspaceRecord(entity) : undefined;
  }

  public async findById(
    workspaceId: string,
    transaction?: EntityManager,
  ): Promise<WorkspaceRecord | undefined> {
    const entity = await this.repository(transaction).findOne({
      where: { id: workspaceId },
    });

    return entity ? toWorkspaceRecord(entity) : undefined;
  }

  public async update(
    workspaceId: string,
    input: UpdateWorkspaceRecordInput,
    transaction: EntityManager,
  ): Promise<boolean> {
    const result = await transaction.getRepository(WorkspaceEntity).update(
      { id: workspaceId, version: input.expectedVersion },
      {
        name: input.name,
        timezone: input.timezone,
        locale: input.locale,
        version: input.nextVersion,
        updatedAt: input.updatedAt,
      },
    );

    return (result.affected ?? 0) === 1;
  }

  private repository(transaction?: EntityManager): Repository<WorkspaceEntity> {
    return (transaction ?? this.dataSource.manager).getRepository(WorkspaceEntity);
  }
}

function toWorkspaceRecord(entity: WorkspaceEntity): WorkspaceRecord {
  return {
    id: entity.id,
    key: entity.key,
    name: entity.name,
    timezone: entity.timezone,
    locale: entity.locale,
    isDefault: entity.isDefault,
    version: entity.version,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}
