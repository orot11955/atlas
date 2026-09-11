import type { DataSource, EntityManager } from 'typeorm';
import type {
  WebhookKeyMaintenanceRepositoryPort,
  WebhookKeyUsage,
  WebhookReencryptionRecord,
} from '../../ports/webhook-key-maintenance.port';
import { requireEventingTransaction } from './eventing-attempt.persistence';
import { unwrapTypeOrmMutationRows } from './typeorm-mutation-result';

export class TypeOrmWebhookKeyMaintenanceRepository implements WebhookKeyMaintenanceRepositoryPort<EntityManager> {
  public constructor(private readonly dataSource: DataSource) {}

  public async usage(workspaceId?: string): Promise<readonly WebhookKeyUsage[]> {
    const rows = await this.dataSource.query<{ key_version: string; count: string }[]>(
      `SELECT secret_key_version AS key_version, count(*) AS count FROM webhook_endpoints
       WHERE ($1::uuid IS NULL OR workspace_id = $1)
       GROUP BY secret_key_version ORDER BY secret_key_version`,
      [workspaceId ?? null],
    );
    return rows.map((row) => {
      const count = Number(row.count);
      if (!Number.isSafeInteger(count) || count < 1) throw new Error('Invalid key usage count.');
      return { keyVersion: row.key_version, count };
    });
  }

  public async lockBatch(
    workspaceId: string,
    activeVersion: string,
    limit: number,
    transaction: EntityManager,
  ): Promise<readonly WebhookReencryptionRecord[]> {
    requireEventingTransaction(transaction);
    const rows = await transaction.query<
      {
        id: string;
        workspace_id: string;
        secret_ciphertext: string;
        secret_key_version: string;
        version: number;
      }[]
    >(
      `SELECT id, workspace_id, secret_ciphertext, secret_key_version, version
       FROM webhook_endpoints WHERE workspace_id = $1 AND secret_key_version <> $2
       ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $3`,
      [workspaceId, activeVersion, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      ciphertext: row.secret_ciphertext,
      keyVersion: row.secret_key_version,
      version: row.version,
    }));
  }

  public async replaceCiphertext(
    current: Readonly<WebhookReencryptionRecord>,
    encryptedValue: string,
    keyVersion: string,
    transaction: EntityManager,
  ): Promise<boolean> {
    requireEventingTransaction(transaction);
    // Storage-only rewrite preserves endpoint policy/version/updatedAt. Signing-secret
    // rotation locks this same row and increments version through its existing path.
    const result = await transaction.query(
      `UPDATE webhook_endpoints SET secret_ciphertext = $6, secret_key_version = $7
       WHERE id = $1 AND workspace_id = $2 AND version = $3
         AND secret_ciphertext = $4 AND secret_key_version = $5 RETURNING id`,
      [
        current.id,
        current.workspaceId,
        current.version,
        current.ciphertext,
        current.keyVersion,
        encryptedValue,
        keyVersion,
      ],
    );
    const rows = unwrapTypeOrmMutationRows<{ id: string }>(result);
    if (rows.length > 1) throw new Error('Invalid Webhook re-encryption update result.');
    return rows.length === 1;
  }
}
