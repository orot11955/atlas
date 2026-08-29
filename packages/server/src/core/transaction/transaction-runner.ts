export type TransactionWork<TTransaction, TResult> = (
  transaction: TTransaction,
) => Promise<TResult>;

export interface TransactionRunner<TTransaction = unknown> {
  run<TResult>(work: TransactionWork<TTransaction, TResult>): Promise<TResult>;
}

export class PassthroughTransactionRunner implements TransactionRunner<void> {
  public async run<TResult>(work: TransactionWork<void, TResult>): Promise<TResult> {
    return work(undefined);
  }
}
