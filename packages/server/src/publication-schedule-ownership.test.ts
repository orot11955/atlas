import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AuditService,
  DomainError,
  ErrorCode,
  FixedClock,
  createUuidV7,
  type AuditRecord,
  type TransactionRunner,
} from './core';
import { PublicationScheduleProcessor } from './modules/eventing/application/publication-scheduling.service';
import type { PublicationScheduleRecord } from './modules/eventing/domain/eventing';
import type {
  EventingRepositoryPort,
  PublicationScheduleAttemptOwner,
} from './modules/eventing/ports/eventing.repository';
import type { PublicationCommandPort } from './modules/eventing/ports/publication-command.port';

type AttemptRepository = Pick<
  EventingRepositoryPort<symbol>,
  | 'startPublicationScheduleAttempt'
  | 'completePublicationSchedule'
  | 'reschedulePublicationSchedule'
>;

function fixture(options: { claimed?: boolean; changed?: boolean; failure?: Error } = {}) {
  const clock = new FixedClock('2026-09-06T00:00:00Z');
  const schedule: PublicationScheduleRecord = {
    id: createUuidV7(1),
    workspaceId: createUuidV7(2),
    siteId: createUuidV7(3),
    contentId: createUuidV7(4),
    contentSiteId: createUuidV7(5),
    action: 'publish',
    scheduledFor: clock.now(),
    timezone: 'UTC',
    scheduledLocalAt: '2026-09-06T00:00:00',
    status: 'processing',
    attemptCount: 3,
    nextAttemptAt: clock.now(),
    version: 9,
    requestedByAdminAccountId: createUuidV7(6),
    createdAt: clock.now(),
    updatedAt: clock.now(),
  };
  const audits: AuditRecord[] = [];
  const owners: Readonly<PublicationScheduleAttemptOwner>[] = [];
  const transactions = new Set<symbol>();
  let transitionTransaction: symbol | undefined;
  let commands = 0;
  const runner: TransactionRunner<symbol> = {
    async run(work) {
      const transaction = Symbol('transaction');
      transactions.add(transaction);
      try {
        return await work(transaction);
      } finally {
        transactions.delete(transaction);
      }
    },
  };
  const repository: AttemptRepository = {
    async startPublicationScheduleAttempt() {
      return options.claimed === false ? undefined : { ...schedule };
    },
    async completePublicationSchedule(owner, _at, transaction) {
      assert.ok(transactions.has(transaction));
      transitionTransaction = transaction;
      owners.push(owner);
      return options.changed !== false;
    },
    async reschedulePublicationSchedule(owner, _next, _error, _terminal, _at, transaction) {
      assert.ok(transactions.has(transaction));
      transitionTransaction = transaction;
      owners.push(owner);
      return options.changed !== false;
    },
  };
  const audit = new AuditService<symbol>(
    {
      async insert(record, transaction) {
        assert.equal(transaction, transitionTransaction);
        assert.ok(transaction && transactions.has(transaction));
        audits.push(record);
      },
    },
    clock,
  );
  const command: PublicationCommandPort = {
    async publish() {
      assert.equal(transactions.size, 0, 'command execution must not hold a schedule transaction');
      commands += 1;
      if (options.failure) throw options.failure;
      return { replayed: false };
    },
    async withdraw() {
      throw new Error('unexpected withdraw');
    },
  };
  const processor = new PublicationScheduleProcessor(
    runner,
    repository as EventingRepositoryPort<symbol>,
    command,
    audit,
    clock,
  );
  return { schedule, audits, owners, processor, commands: () => commands };
}

test('unclaimed schedule does not invoke a command or write lifecycle Audit', async () => {
  const f = fixture({ claimed: false });
  await f.processor.process(f.schedule.id, 3);
  assert.equal(f.commands(), 0);
  assert.equal(f.owners.length, 0);
  assert.equal(f.audits.length, 0);
});

test('completion sends the committed claim identity and records Audit in its transaction', async () => {
  const f = fixture();
  await f.processor.process(f.schedule.id, 3);
  assert.deepEqual(f.owners, [
    {
      scheduleId: f.schedule.id,
      workspaceId: f.schedule.workspaceId,
      attemptNumber: 3,
      version: 9,
    },
  ]);
  assert.equal(f.audits.length, 1);
  assert.equal(f.audits[0]?.action, 'content.publication-schedule-completed');
  assert.equal(f.audits[0]?.metadata.attemptNumber, 3);
});

test('stale success is a no-op and cannot manufacture completion Audit', async () => {
  const f = fixture({ changed: false });
  await f.processor.process(f.schedule.id, 3);
  assert.equal(f.commands(), 1);
  assert.equal(f.owners.length, 1);
  assert.equal(f.audits.length, 0);
});

for (const terminal of [false, true]) {
  for (const changed of [false, true]) {
    test(`${terminal ? 'terminal' : 'retryable'} failure only records Audit for the current owner (${changed})`, async () => {
      const failure = terminal
        ? new DomainError({ code: ErrorCode.NOT_FOUND, message: 'missing target' })
        : new Error('temporary command failure');
      const f = fixture({ changed, failure });
      await assert.rejects(f.processor.process(f.schedule.id, 3), (error) => error === failure);
      assert.deepEqual(f.owners, [
        {
          scheduleId: f.schedule.id,
          workspaceId: f.schedule.workspaceId,
          attemptNumber: 3,
          version: 9,
        },
      ]);
      assert.equal(f.audits.length, changed ? 1 : 0);
      if (changed) {
        assert.equal(
          f.audits[0]?.action,
          terminal
            ? 'content.publication-schedule-failed'
            : 'content.publication-schedule-retry-scheduled',
        );
      }
    });
  }
}

// Driver contract checks complement the real PostgreSQL race gate. Unknown affected
// counts must abort the transaction rather than being treated as a stale no-op.
test('schedule persistence rejects unknown or impossible affected-row counts', async () => {
  const { TypeOrmEventingRepository } =
    await import('./modules/eventing/infrastructure/persistence/typeorm-eventing.repository');
  const repository = new TypeOrmEventingRepository(undefined as never);
  const owner = {
    scheduleId: createUuidV7(10),
    workspaceId: createUuidV7(11),
    attemptNumber: 1,
    version: 2,
  };
  for (const affected of [undefined, null, -1, 1.5, 2]) {
    const builder = {
      update() {
        return this;
      },
      set() {
        return this;
      },
      where() {
        return this;
      },
      andWhere() {
        return this;
      },
      async execute() {
        return { affected };
      },
    };
    const manager = {
      queryRunner: { isTransactionActive: true },
      getRepository: () => ({ createQueryBuilder: () => builder }),
    };
    await assert.rejects(
      repository.completePublicationSchedule(owner, new Date(), manager as never),
      /affected-row count/u,
    );
    await assert.rejects(
      repository.reschedulePublicationSchedule(
        owner,
        new Date(),
        'failure',
        false,
        new Date(),
        manager as never,
      ),
      /affected-row count/u,
    );
  }
});
