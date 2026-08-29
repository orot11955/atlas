import type { AuditService, Clock, TransactionRunner } from '../../../core';
import {
  ActorType,
  AuditResult,
  DomainError,
  ErrorCode,
  requestContext,
  systemClock,
} from '../../../core';
import { AdminAccountStatus } from '../domain/admin-account-status';
import {
  fingerprintAdminLoginValue,
  normalizeAdminLoginClientAddress,
} from '../domain/admin-login';
import {
  AdminSessionRevokeReason,
  AdminSessionStatus,
  assertAdminSessionFingerprintPepper,
  calculateAdminSessionExpiry,
  calculateTouchedIdleExpiry,
  createAdminSessionAuthenticationError,
  createAdminSessionCsrfError,
  hasAdminAccountSnapshotChanged,
  normalizeAdminSessionUserAgent,
  resolveAdminSessionStatus,
  shouldTouchAdminSession,
  validateAdminSessionPolicy,
  type AdminSessionPolicy,
} from '../domain/admin-session';
import { Sha256AdminAuthenticationGrantTokenIssuer } from '../infrastructure/crypto/sha256-admin-authentication-grant-token-issuer';
import type {
  AdminSessionRepositoryPort,
  AdminSessionRecord,
} from '../ports/admin-session.repository';
import type { AdminSessionTokenIssuerPort } from '../ports/admin-session-token-issuer.port';

export interface CreateAdminSessionInput {
  grantId: string;
  grantToken: string;
  clientAddress: string;
  userAgent?: string;
}

export interface AuthenticateAdminSessionInput {
  sessionToken: string;
  clientAddress: string;
}

export interface AdminSessionPrincipal {
  sessionId: string;
  adminAccountId: string;
  role: AdminSessionRecord['role'];
  csrfTokenDigest: string;
  userAgentSummary: string;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface CreateAdminSessionResult {
  sessionToken: string;
  csrfToken: string;
  session: Readonly<AdminSessionPrincipal>;
}

export interface AdminSessionListItem {
  id: string;
  current: boolean;
  status: AdminSessionStatus;
  userAgentSummary: string;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt?: Date;
  revokeReason?: AdminSessionRecord['revokeReason'];
}

export class AdminSessionService<TTransaction> {
  private readonly policy: Readonly<AdminSessionPolicy>;

  public constructor(
    private readonly transactionRunner: TransactionRunner<TTransaction>,
    private readonly repository: AdminSessionRepositoryPort<TTransaction>,
    private readonly grantTokenIssuer: Sha256AdminAuthenticationGrantTokenIssuer,
    private readonly sessionTokenIssuer: AdminSessionTokenIssuerPort,
    private readonly auditService: AuditService<TTransaction>,
    private readonly loginFingerprintPepper: string,
    private readonly sessionFingerprintPepper: string,
    policy: AdminSessionPolicy,
    private readonly clock: Clock = systemClock,
  ) {
    assertAdminSessionFingerprintPepper(loginFingerprintPepper);
    assertAdminSessionFingerprintPepper(sessionFingerprintPepper);
    this.policy = validateAdminSessionPolicy(policy);
  }

  public async createSession(
    input: CreateAdminSessionInput,
  ): Promise<Readonly<CreateAdminSessionResult>> {
    assertIdentifier(input.grantId, 'grantId');
    assertBoundedToken(input.grantToken, 'grantToken');
    const clientAddress = normalizeAdminLoginClientAddress(input.clientAddress);
    const now = this.clock.now();
    const loginClientFingerprint = fingerprintAdminLoginValue(
      this.loginFingerprintPepper,
      'ip',
      clientAddress,
    );
    const sessionClientFingerprint = fingerprintAdminLoginValue(
      this.sessionFingerprintPepper,
      'ip',
      clientAddress,
    );
    const issued = this.sessionTokenIssuer.issue(now);
    const expiry = calculateAdminSessionExpiry(now, this.policy);
    const userAgentSummary = normalizeAdminSessionUserAgent(input.userAgent);

    const principal = await this.transactionRunner.run(async (transaction) => {
      const grant = await this.repository.findGrantForUpdate(input.grantId, transaction);

      if (
        !grant ||
        !this.grantTokenIssuer.matches(input.grantToken, grant.tokenDigest) ||
        grant.consumedAt ||
        grant.invalidatedAt ||
        grant.expiresAt.getTime() <= now.getTime() ||
        grant.ipFingerprint !== loginClientFingerprint
      ) {
        throw createAdminSessionAuthenticationError();
      }

      const account = await this.repository.findAccountForSession(
        grant.adminAccountId,
        transaction,
      );

      if (!account || account.status !== AdminAccountStatus.ACTIVE) {
        throw createAdminSessionAuthenticationError();
      }

      await this.repository.revokeOldestActiveSessions(
        account.id,
        Math.max(0, this.policy.maximumActiveSessions - 1),
        now,
        transaction,
      );
      await this.repository.consumeGrant(grant.id, now, transaction);
      await this.repository.insertSession(
        {
          id: issued.id,
          adminAccountId: account.id,
          sourceGrantId: grant.id,
          tokenDigest: issued.tokenDigest,
          csrfTokenDigest: issued.csrfTokenDigest,
          clientFingerprint: sessionClientFingerprint,
          role: account.role,
          passwordChangedAt: account.passwordChangedAt,
          userAgentSummary,
          createdAt: now,
          lastSeenAt: now,
          idleExpiresAt: expiry.idleExpiresAt,
          absoluteExpiresAt: expiry.absoluteExpiresAt,
        },
        transaction,
      );
      await this.auditService.record(
        {
          action: 'admin.session.created',
          targetType: 'admin-session',
          targetId: issued.id,
          result: AuditResult.SUCCESS,
          metadata: {
            adminAccountId: account.id,
            sourceGrantId: grant.id,
            userAgentSummary,
            idleExpiresAt: expiry.idleExpiresAt,
            absoluteExpiresAt: expiry.absoluteExpiresAt,
          },
        },
        transaction,
      );

      return toPrincipal({
        id: issued.id,
        adminAccountId: account.id,
        sourceGrantId: grant.id,
        tokenDigest: issued.tokenDigest,
        csrfTokenDigest: issued.csrfTokenDigest,
        clientFingerprint: sessionClientFingerprint,
        role: account.role,
        passwordChangedAt: account.passwordChangedAt,
        userAgentSummary,
        createdAt: now,
        lastSeenAt: now,
        idleExpiresAt: expiry.idleExpiresAt,
        absoluteExpiresAt: expiry.absoluteExpiresAt,
      });
    });

    return Object.freeze({
      sessionToken: issued.token,
      csrfToken: issued.csrfToken,
      session: principal,
    });
  }

  public async authenticateSession(
    input: AuthenticateAdminSessionInput,
  ): Promise<Readonly<AdminSessionPrincipal>> {
    assertBoundedToken(input.sessionToken, 'sessionToken');
    const parsed = this.sessionTokenIssuer.parseSessionToken(input.sessionToken);

    if (!parsed) {
      throw createAdminSessionAuthenticationError();
    }

    const clientAddress = normalizeAdminLoginClientAddress(input.clientAddress);
    const clientFingerprint = fingerprintAdminLoginValue(
      this.sessionFingerprintPepper,
      'ip',
      clientAddress,
    );
    const now = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const session = await this.repository.findSessionForUpdate(parsed.id, transaction);

      if (
        !session ||
        !this.sessionTokenIssuer.matchesSessionToken(input.sessionToken, session.tokenDigest)
      ) {
        throw createAdminSessionAuthenticationError();
      }

      const status = resolveAdminSessionStatus(session, now);

      if (status !== AdminSessionStatus.ACTIVE) {
        if (!session.revokedAt) {
          await this.repository.revokeSession(
            session.id,
            now,
            AdminSessionRevokeReason.EXPIRED,
            transaction,
          );
        }

        throw createAdminSessionAuthenticationError();
      }

      if (this.policy.bindClientAddress && session.clientFingerprint !== clientFingerprint) {
        throw createAdminSessionAuthenticationError();
      }

      const account = await this.repository.findAccountForSession(
        session.adminAccountId,
        transaction,
      );

      if (
        !account ||
        account.status !== AdminAccountStatus.ACTIVE ||
        hasAdminAccountSnapshotChanged(session, account)
      ) {
        await this.repository.revokeSession(
          session.id,
          now,
          AdminSessionRevokeReason.ACCOUNT_CHANGED,
          transaction,
        );
        throw createAdminSessionAuthenticationError();
      }

      let current = session;

      if (shouldTouchAdminSession(session.lastSeenAt, now, this.policy)) {
        const idleExpiresAt = calculateTouchedIdleExpiry(
          now,
          session.absoluteExpiresAt,
          this.policy,
        );
        await this.repository.touchSession(
          session.id,
          { lastSeenAt: now, idleExpiresAt },
          transaction,
        );
        current = { ...session, lastSeenAt: now, idleExpiresAt };
      }

      return toPrincipal(current);
    });
  }

  public enterRequestContext(principal: Readonly<AdminSessionPrincipal>): void {
    const current = requestContext.require();
    requestContext.enter({
      ...current,
      actorType: ActorType.ADMIN,
      actorId: principal.adminAccountId,
      sessionId: principal.sessionId,
    });
  }

  public assertCsrf(
    principal: Readonly<AdminSessionPrincipal>,
    cookieToken?: string,
    headerToken?: string,
  ): void {
    if (
      !cookieToken ||
      !headerToken ||
      cookieToken !== headerToken ||
      !this.sessionTokenIssuer.matchesCsrfToken(headerToken, principal.csrfTokenDigest)
    ) {
      throw createAdminSessionCsrfError();
    }
  }

  public async logout(principal: Readonly<AdminSessionPrincipal>): Promise<void> {
    const now = this.clock.now();

    await this.transactionRunner.run(async (transaction) => {
      await this.repository.revokeSession(
        principal.sessionId,
        now,
        AdminSessionRevokeReason.LOGOUT,
        transaction,
      );
      await this.auditService.record(
        {
          action: 'admin.session.logged-out',
          targetType: 'admin-session',
          targetId: principal.sessionId,
          result: AuditResult.SUCCESS,
          metadata: { adminAccountId: principal.adminAccountId },
        },
        transaction,
      );
    });
  }

  public async listSessions(
    principal: Readonly<AdminSessionPrincipal>,
  ): Promise<readonly Readonly<AdminSessionListItem>[]> {
    const now = this.clock.now();
    const sessions = await this.repository.listSessionsForAccount(principal.adminAccountId);

    return sessions.map((session) =>
      Object.freeze({
        id: session.id,
        current: session.id === principal.sessionId,
        status: resolveAdminSessionStatus(session, now),
        userAgentSummary: session.userAgentSummary,
        createdAt: new Date(session.createdAt),
        lastSeenAt: new Date(session.lastSeenAt),
        idleExpiresAt: new Date(session.idleExpiresAt),
        absoluteExpiresAt: new Date(session.absoluteExpiresAt),
        ...(session.revokedAt ? { revokedAt: new Date(session.revokedAt) } : {}),
        ...(session.revokeReason ? { revokeReason: session.revokeReason } : {}),
      }),
    );
  }

  public async revokeOtherSessions(principal: Readonly<AdminSessionPrincipal>): Promise<number> {
    const now = this.clock.now();

    return this.transactionRunner.run(async (transaction) => {
      const revokedCount = await this.repository.revokeOtherActiveSessions(
        principal.adminAccountId,
        principal.sessionId,
        now,
        transaction,
      );
      await this.auditService.record(
        {
          action: 'admin.session.others-revoked',
          targetType: 'admin-account',
          targetId: principal.adminAccountId,
          result: AuditResult.SUCCESS,
          metadata: {
            currentSessionId: principal.sessionId,
            revokedCount,
          },
        },
        transaction,
      );
      return revokedCount;
    });
  }

  public async revokeSession(
    principal: Readonly<AdminSessionPrincipal>,
    sessionId: string,
  ): Promise<void> {
    assertIdentifier(sessionId, 'sessionId');
    const now = this.clock.now();

    await this.transactionRunner.run(async (transaction) => {
      const target = await this.repository.findSessionForUpdate(sessionId, transaction);

      if (!target || target.adminAccountId !== principal.adminAccountId) {
        throw new DomainError({
          code: ErrorCode.NOT_FOUND,
          message: 'Administrator session was not found.',
        });
      }

      await this.repository.revokeSession(
        target.id,
        now,
        AdminSessionRevokeReason.REVOKED_BY_ADMIN,
        transaction,
      );
      await this.auditService.record(
        {
          action: 'admin.session.revoked',
          targetType: 'admin-session',
          targetId: target.id,
          result: AuditResult.SUCCESS,
          metadata: {
            adminAccountId: principal.adminAccountId,
            currentSessionId: principal.sessionId,
          },
        },
        transaction,
      );
    });
  }
}

function toPrincipal(session: AdminSessionRecord): Readonly<AdminSessionPrincipal> {
  return Object.freeze({
    sessionId: session.id,
    adminAccountId: session.adminAccountId,
    role: session.role,
    csrfTokenDigest: session.csrfTokenDigest,
    userAgentSummary: session.userAgentSummary,
    createdAt: new Date(session.createdAt),
    lastSeenAt: new Date(session.lastSeenAt),
    idleExpiresAt: new Date(session.idleExpiresAt),
    absoluteExpiresAt: new Date(session.absoluteExpiresAt),
  });
}

function assertIdentifier(value: string, field: string): void {
  if (!/^[0-9a-f-]{36}$/u.test(value)) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: `${field} is invalid.`,
      details: { field },
    });
  }
}

function assertBoundedToken(value: string, field: string): void {
  if (value.length < 32 || value.length > 512) {
    throw new DomainError({
      code: ErrorCode.VALIDATION_FAILED,
      message: `${field} is invalid.`,
      details: { field },
    });
  }
}
