import type { WebhookSecretCipherPort } from './webhook-secret-cipher.port';

export interface WebhookKeyringPort extends WebhookSecretCipherPort {
  readonly activeVersion: string;
  readonly readableVersions: readonly string[];
}

export interface WebhookKeyUsage {
  keyVersion: string;
  count: number;
}

/** Internal maintenance record. Never return ciphertext through an operator view. */
export interface WebhookReencryptionRecord {
  id: string;
  workspaceId: string;
  ciphertext: string;
  keyVersion: string;
  version: number;
}

export interface WebhookKeyMaintenanceRepositoryPort<TTransaction> {
  usage(workspaceId?: string): Promise<readonly WebhookKeyUsage[]>;
  lockBatch(
    workspaceId: string,
    activeVersion: string,
    limit: number,
    transaction: TTransaction,
  ): Promise<readonly WebhookReencryptionRecord[]>;
  replaceCiphertext(
    current: Readonly<WebhookReencryptionRecord>,
    encryptedValue: string,
    keyVersion: string,
    transaction: TTransaction,
  ): Promise<boolean>;
}
