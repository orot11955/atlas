import type { WorkspaceRecord } from '../domain/workspace';

export interface UpdateWorkspaceRecordInput {
  name: string;
  timezone: string;
  locale: string;
  expectedVersion: number;
  nextVersion: number;
  updatedAt: Date;
}

export interface WorkspaceRepositoryPort<TTransaction = unknown> {
  findDefault(transaction?: TTransaction): Promise<WorkspaceRecord | undefined>;
  findById(workspaceId: string, transaction?: TTransaction): Promise<WorkspaceRecord | undefined>;
  update(
    workspaceId: string,
    input: UpdateWorkspaceRecordInput,
    transaction: TTransaction,
  ): Promise<boolean>;
}
