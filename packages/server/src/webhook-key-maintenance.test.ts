import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuditService } from './core/audit/audit.service';
import type { AuditRecord } from './core/audit/audit-record';
import { createUuidV7 } from './core/ids/uuid-v7';
import { ActorType, requestContext } from './core/request-context/request-context';
import type { TransactionRunner } from './core/transaction/transaction-runner';
import { Aes256GcmWebhookSecretCipher as Cipher } from './modules/eventing/infrastructure/crypto/aes256-gcm-webhook-secret-cipher';
import {
  WebhookKeyMaintenanceService,
  assertWebhookKeyCoverage,
} from './modules/eventing/application/webhook-key-maintenance.service';
import type {
  WebhookKeyMaintenanceRepositoryPort,
  WebhookReencryptionRecord,
} from './modules/eventing/ports/webhook-key-maintenance.port';

const oldKey = Buffer.alloc(32, 0x13).toString('base64');
const newKey = Buffer.alloc(32, 0x27).toString('base64');
const secret = 'signing-secret-must-survive-storage-key-replacement';
const oldCipher = new Cipher(oldKey, 'v1');
const newCipher = new Cipher(newKey, 'v2', JSON.stringify([{ version: 'v1', keyBase64: oldKey }]));

type Row = WebhookReencryptionRecord & { disabled: boolean; updatedAt: string };
type State = { rows: Row[]; logs: AuditRecord[] };
// An explicit in-memory transaction double. These tests make no PostgreSQL locking claims.
function fixture() {
  const workspace = createUuidV7();
  const otherWorkspace = createUuidV7();
  const row = (workspaceId: string, disabled = false): Row => ({
    id: createUuidV7(),
    workspaceId,
    ciphertext: oldCipher.encrypt(secret).encryptedValue,
    keyVersion: 'v1',
    version: 7,
    disabled,
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  let state: State = {
    rows: [row(workspace), row(workspace, true), row(otherWorkspace)],
    logs: [],
  };
  const flags = { failAudit: false, conflict: false, badScope: false };
  let transactions = 0;
  const runner: TransactionRunner<State> = {
    async run(work) {
      transactions += 1;
      const pending = structuredClone(state);
      const result = await work(pending);
      state = pending;
      return result;
    },
  };
  const repo: WebhookKeyMaintenanceRepositoryPort<State> = {
    async usage(workspaceId) {
      const counts = new Map<string, number>();
      for (const r of state.rows.filter((r) => !workspaceId || workspaceId === r.workspaceId)) {
        counts.set(r.keyVersion, (counts.get(r.keyVersion) ?? 0) + 1);
      }
      return [...counts].map(([keyVersion, count]) => ({ keyVersion, count }));
    },
    async lockBatch(workspaceId, activeVersion, limit, tx) {
      return tx.rows
        .filter(
          (r) =>
            r.workspaceId === (flags.badScope ? otherWorkspace : workspaceId) &&
            r.keyVersion !== activeVersion,
        )
        .slice(0, limit)
        .map((row) => ({ ...row }));
    },
    async replaceCiphertext(current, encryptedValue, keyVersion, tx) {
      if (flags.conflict) return false;
      const target = tx.rows.find(
        (r) =>
          r.id === current.id &&
          r.workspaceId === current.workspaceId &&
          r.version === current.version &&
          r.ciphertext === current.ciphertext &&
          r.keyVersion === current.keyVersion,
      );
      if (!target) return false;
      target.ciphertext = encryptedValue;
      target.keyVersion = keyVersion;
      return true;
    },
  };
  const audit = new AuditService<State>({
    async insert(record, tx) {
      assert.ok(tx);
      tx.logs.push(record);
      if (flags.failAudit) throw new Error('Injected audit failure.');
    },
  });
  const service = new WebhookKeyMaintenanceService(runner, repo, newCipher, audit);
  const scoped = <T>(work: () => T, patch = {}) =>
    requestContext.run(
      {
        requestId: createUuidV7(),
        traceId: createUuidV7(),
        workspaceId: workspace,
        actorId: 'cli:webhook-encryption',
        actorType: ActorType.SYSTEM,
        ...patch,
      },
      work,
    );
  return {
    workspace,
    otherWorkspace,
    service,
    repo,
    flags,
    scoped,
    read: () => structuredClone(state),
    mutate: (work: (value: State) => void) => work(state),
    transactions: () => transactions,
  };
}

test('batch preserves signing secret and endpoint policy while writing same-transaction Audit', async () => {
  const f = fixture();
  const before = f.read();
  assert.deepEqual(await f.scoped(() => f.service.reencryptBatch(f.workspace, 'v2')), {
    changed: 2,
    activeVersion: 'v2',
  });
  const after = f.read();
  assert.equal(after.logs.length, 2);
  for (const [index, row] of after.rows.entries()) {
    if (row.workspaceId === f.workspace) {
      assert.equal(row.keyVersion, 'v2');
      assert.equal(newCipher.decrypt(row.ciphertext, row.keyVersion), secret);
      const original = before.rows[index]!;
      assert.deepEqual(
        { ...row, ciphertext: original.ciphertext, keyVersion: original.keyVersion },
        original,
      );
    } else assert.deepEqual(row, before.rows[index]);
  }
  const serialized = JSON.stringify(after.logs);
  for (const value of [oldKey, newKey, secret, ...after.rows.map((r) => r.ciphertext)]) {
    assert.ok(!serialized.includes(value));
  }
  assert.equal(after.logs[0]?.action, 'webhook.secret-reencrypted');
  assert.equal(after.logs[0]?.workspaceId, f.workspace);
  assert.deepEqual(after.logs[0]?.metadata, { fromVersion: 'v1', toVersion: 'v2' });
});

test('bounded batches converge and repeating a completed batch adds no Audit', async () => {
  const f = fixture();
  for (const expected of [1, 1, 0]) {
    assert.equal(
      (await f.scoped(() => f.service.reencryptBatch(f.workspace, 'v2', 1))).changed,
      expected,
    );
  }
  assert.equal(f.read().logs.length, 2);
});

test('Audit failure rolls back ciphertext, key version and all Audit entries', async () => {
  const f = fixture();
  const before = f.read();
  f.flags.failAudit = true;
  await assert.rejects(
    f.scoped(() => f.service.reencryptBatch(f.workspace, 'v2')),
    /Injected/u,
  );
  assert.deepEqual(f.read(), before);
});

test('corrupted second ciphertext rolls back the earlier rewrite in the same batch', async () => {
  const f = fixture();
  f.mutate((s) => {
    s.rows[1]!.ciphertext = 'w1.invalid.invalid.invalid';
  });
  const before = f.read();
  await assert.rejects(f.scoped(() => f.service.reencryptBatch(f.workspace, 'v2')));
  assert.deepEqual(f.read(), before);
});

test('unknown old key fails closed without replacing any Secret', async () => {
  const f = fixture();
  f.mutate((s) => {
    s.rows[0]!.keyVersion = 'unavailable';
  });
  const before = f.read();
  await assert.rejects(
    f.scoped(() => f.service.reencryptBatch(f.workspace, 'v2')),
    /not available/u,
  );
  assert.deepEqual(f.read(), before);
});

test('compare-and-swap conflict rolls back rather than claiming success', async () => {
  const f = fixture();
  f.flags.conflict = true;
  const before = f.read();
  await assert.rejects(
    f.scoped(() => f.service.reencryptBatch(f.workspace, 'v2')),
    /changed/u,
  );
  assert.deepEqual(f.read(), before);
});

test('unexpected cross-Workspace repository row is refused before decryption and update', async () => {
  const f = fixture();
  f.flags.badScope = true;
  const before = f.read();
  await assert.rejects(
    f.scoped(() => f.service.reencryptBatch(f.workspace, 'v2')),
    /scoped/u,
  );
  assert.deepEqual(f.read(), before);
});

test('missing context and anonymous or wrong-Workspace actors cannot start a batch', async () => {
  const f = fixture();
  await assert.rejects(f.service.reencryptBatch(f.workspace, 'v2'));
  await assert.rejects(
    f.scoped(() => f.service.reencryptBatch(f.workspace, 'v2'), {
      actorType: ActorType.ANONYMOUS,
    }),
  );
  await assert.rejects(
    f.scoped(() => f.service.reencryptBatch(f.workspace, 'v2'), {
      workspaceId: f.otherWorkspace,
    }),
  );
  assert.equal(f.transactions(), 0);
});

test('wrong active version, invalid workspace and invalid limits fail before transaction', async () => {
  const f = fixture();
  await assert.rejects(f.scoped(() => f.service.reencryptBatch(f.workspace, 'v1')));
  await assert.rejects(f.scoped(() => f.service.reencryptBatch('invalid', 'v2')));
  for (const limit of [0, -1, 1.5, 51, Number.NaN]) {
    await assert.rejects(f.scoped(() => f.service.reencryptBatch(f.workspace, 'v2', limit)));
  }
  assert.equal(f.transactions(), 0);
});

test('retirement check includes every Workspace and disabled endpoint', async () => {
  const f = fixture();
  await assert.rejects(f.service.assertRetirable('v2'), /active/u);
  await assert.rejects(f.service.assertRetirable('v1'), /references/u);
  await f.scoped(() => f.service.reencryptBatch(f.workspace, 'v2'));
  await assert.rejects(f.service.assertRetirable('v1'), /references/u);
  await f.scoped(() => f.service.reencryptBatch(f.otherWorkspace, 'v2'), {
    workspaceId: f.otherWorkspace,
  });
  await f.service.assertRetirable('v1');
  await assertWebhookKeyCoverage(f.repo, new Cipher(newKey, 'v2'));
});

test('version coverage guard rejects removing an in-use decrypt key', async () => {
  const f = fixture();
  await assertWebhookKeyCoverage(f.repo, newCipher);
  await assert.rejects(assertWebhookKeyCoverage(f.repo, new Cipher(newKey, 'v2')), /cover/u);
});

test('operator inventory exposes only version, count and readability', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.inspect(f.workspace), {
    activeVersion: 'v2',
    usage: [{ keyVersion: 'v1', count: 2, readable: true }],
  });
  assert.equal((await f.service.inspect()).usage[0]?.count, 3);
  assert.ok(Object.isFrozen((await f.service.inspect()).usage));
});
