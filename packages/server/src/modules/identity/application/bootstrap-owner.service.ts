import type { AuditService, Clock, TransactionRunner } from '../../../core';
import { DomainError, ErrorCode, createUuidV7, systemClock } from '../../../core';
import { normalizeAdminDisplayName, normalizeAdminEmail } from '../domain/admin-account';
import { AdminAccountStatus } from '../domain/admin-account-status';
import { AdminRole } from '../domain/admin-role';
import { assertAdminPasswordPolicy } from '../domain/password-policy';
import type { AdminAccountRepositoryPort } from '../ports/admin-account.repository';
import type { PasswordHasher } from '../ports/password-hasher.port';

export interface BootstrapOwnerInput {
  email: string;
  displayName?: string;
  password: string;
}

export interface BootstrapOwnerResult {
  id: string;
  email: string;
  displayName: string;
  role: typeof AdminRole.OWNER;
  createdAt: Date;
}

export class BootstrapOwnerService<TTransaction> {
  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: AdminAccountRepositoryPort<TTransaction>,
    private readonly passwordHasher: PasswordHasher,
    private readonly auditService: AuditService<TTransaction>,
    private readonly clock: Clock = systemClock,
  ) {}

  public async execute(input: BootstrapOwnerInput): Promise<Readonly<BootstrapOwnerResult>> {
    const email = normalizeAdminEmail(input.email);
    const displayName = normalizeAdminDisplayName(input.displayName);
    assertAdminPasswordPolicy(input.password);

    const passwordHash = await this.passwordHasher.hash(input.password);
    const createdAt = this.clock.now();
    const id = createUuidV7(createdAt.getTime());

    return this.transactionRunner.run(async (transaction) => {
      await this.repository.acquireOwnerBootstrapLock(transaction);

      if (await this.repository.existsByRole(AdminRole.OWNER, transaction)) {
        throw new DomainError({
          code: ErrorCode.ADMIN_OWNER_ALREADY_EXISTS,
          message: 'An OWNER account has already been bootstrapped.',
        });
      }

      if (await this.repository.existsByEmail(email, transaction)) {
        throw new DomainError({
          code: ErrorCode.ADMIN_EMAIL_ALREADY_EXISTS,
          message: 'An admin account with this email already exists.',
          details: { field: 'email' },
        });
      }

      await this.repository.insert(
        {
          id,
          email,
          displayName,
          passwordHash,
          role: AdminRole.OWNER,
          status: AdminAccountStatus.ACTIVE,
          failedLoginCount: 0,
          passwordChangedAt: createdAt,
          createdAt,
          updatedAt: createdAt,
        },
        transaction,
      );

      await this.auditService.record(
        {
          action: 'admin.owner.bootstrapped',
          targetType: 'admin-account',
          targetId: id,
          metadata: {
            role: AdminRole.OWNER,
            source: 'owner-bootstrap-cli',
          },
        },
        transaction,
      );

      return Object.freeze({
        id,
        email,
        displayName,
        role: AdminRole.OWNER,
        createdAt: new Date(createdAt),
      });
    });
  }
}
