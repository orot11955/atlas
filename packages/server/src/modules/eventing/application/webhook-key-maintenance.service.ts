import { AuditResult } from '../../../core/audit/audit-result';
import type { AuditService } from '../../../core/audit/audit.service';
import { DomainError } from '../../../core/errors/application-error';
import { ErrorCode } from '../../../core/errors/error-code';
import { isUuidV7 } from '../../../core/ids/uuid-v7';
import { ActorType, requestContext } from '../../../core/request-context/request-context';
import type { TransactionRunner } from '../../../core/transaction/transaction-runner';
import type {
  WebhookKeyMaintenanceRepositoryPort,
  WebhookKeyringPort,
} from '../ports/webhook-key-maintenance.port';

/** Checks version coverage, including disabled endpoints, not key bytes or fleet state. */
export async function assertWebhookKeyCoverage<T>(
  repository: WebhookKeyMaintenanceRepositoryPort<T>,
  keyring: WebhookKeyringPort,
): Promise<void> {
  const usage = await repository.usage();
  if (usage.some((row) => !keyring.readableVersions.includes(row.keyVersion))) {
    throw new Error('Webhook keyring does not cover all stored encryption versions.');
  }
}

export class WebhookKeyMaintenanceService<TTransaction> {
  public constructor(
    private readonly runner: TransactionRunner<TTransaction>,
    private readonly repository: WebhookKeyMaintenanceRepositoryPort<TTransaction>,
    private readonly keyring: WebhookKeyringPort,
    private readonly audit: AuditService<TTransaction>,
  ) {}

  public async inspect(workspaceId?: string) {
    if (workspaceId !== undefined) assertWorkspace(workspaceId);
    const usage = await this.repository.usage(workspaceId);
    return Object.freeze({
      activeVersion: this.keyring.activeVersion,
      usage: Object.freeze(
        usage.map((row) =>
          Object.freeze({
            ...row,
            readable: this.keyring.readableVersions.includes(row.keyVersion),
          }),
        ),
      ),
    });
  }

  public async assertRetirable(version: string): Promise<void> {
    if (
      typeof version !== 'string' ||
      !/^[A-Za-z0-9._-]{1,64}$/u.test(version) ||
      version === this.keyring.activeVersion
    ) {
      throw new DomainError({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Cannot retire the active or an invalid key version.',
      });
    }
    const usage = await this.repository.usage();
    if (usage.some((row) => row.keyVersion === version)) {
      throw new DomainError({
        code: ErrorCode.INVALID_STATE_TRANSITION,
        message: 'Encryption key still has stored Webhook references.',
      });
    }
    // Point-in-time DB check only; this never deletes key material or backup keys.
  }

  public async reencryptBatch(workspaceId: string, expectedActiveVersion: string, limit = 25) {
    assertWorkspace(workspaceId);
    const context = requestContext.require();
    if (
      context.workspaceId !== workspaceId ||
      !context.actorId ||
      (context.actorType !== ActorType.ADMIN && context.actorType !== ActorType.SYSTEM)
    ) {
      throw new DomainError({
        code: ErrorCode.FORBIDDEN,
        message: 'A scoped maintenance actor is required.',
      });
    }
    if (expectedActiveVersion !== this.keyring.activeVersion) {
      throw new DomainError({
        code: ErrorCode.VERSION_CONFLICT,
        message: 'Active encryption version does not match the requested operation.',
      });
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new DomainError({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Re-encryption batch size must be 1..50.',
      });
    }
    return this.runner.run(async (tx) => {
      const rows = await this.repository.lockBatch(workspaceId, expectedActiveVersion, limit, tx);
      for (const row of rows) {
        if (row.workspaceId !== workspaceId || row.keyVersion === expectedActiveVersion) {
          throw new Error('Invalid scoped Webhook maintenance record.');
        }
        const plaintext = this.keyring.decrypt(row.ciphertext, row.keyVersion);
        const replacement = this.keyring.encrypt(plaintext);
        if (
          replacement.keyVersion !== expectedActiveVersion ||
          this.keyring.decrypt(replacement.encryptedValue, replacement.keyVersion) !== plaintext
        ) {
          throw new Error('Webhook re-encryption verification failed.');
        }
        const changed = await this.repository.replaceCiphertext(
          row,
          replacement.encryptedValue,
          replacement.keyVersion,
          tx,
        );
        if (!changed) {
          throw new DomainError({
            code: ErrorCode.VERSION_CONFLICT,
            message: 'Webhook changed during re-encryption.',
          });
        }
        await this.audit.record(
          {
            action: 'webhook.secret-reencrypted',
            targetType: 'webhook-endpoint',
            targetId: row.id,
            result: AuditResult.SUCCESS,
            metadata: { fromVersion: row.keyVersion, toVersion: replacement.keyVersion },
          },
          tx,
        );
      }
      return Object.freeze({ changed: rows.length, activeVersion: expectedActiveVersion });
    });
  }
}

function assertWorkspace(value: string): void {
  if (typeof value !== 'string' || !isUuidV7(value)) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Workspace must be a UUIDv7.',
    });
  }
}
