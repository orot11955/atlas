import type { DataSource, EntityManager } from 'typeorm';

import type { TransactionRunner, TransactionWork } from './transaction-runner';

export class TypeOrmTransactionRunner implements TransactionRunner<EntityManager> {
  public constructor(private readonly dataSource: DataSource) {}

  public run<TResult>(work: TransactionWork<EntityManager, TResult>): Promise<TResult> {
    return this.dataSource.transaction((manager) => work(manager));
  }
}
