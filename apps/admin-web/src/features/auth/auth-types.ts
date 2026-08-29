export type AdminRole = 'owner' | 'admin' | 'editor' | 'operator' | 'viewer';

export interface ApiEnvelope<TData> {
  data: TData;
}

export interface AdminLoginChallenge {
  challengeId: string;
  challengeToken: string;
  expiresAt: string;
  nextStep: 'mfa' | 'mfa-setup';
}

export interface AdminTotpEnrollment {
  methodId: string;
  secret: string;
  provisioningUri: string;
  algorithm: 'SHA1';
  digits: 6;
  period: 30;
}

export interface AdminAuthenticationGrant {
  grantId: string;
  grantToken: string;
  expiresAt: string;
  nextStep: 'session';
}

export interface AdminTotpEnrollmentConfirmation extends AdminAuthenticationGrant {
  recoveryCodes: readonly string[];
}

export interface AdminSession {
  id: string;
  role: AdminRole;
  userAgentSummary: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

export type AdminSessionStatus = 'active' | 'expired' | 'revoked';

export interface AdminSessionListItem {
  id: string;
  current: boolean;
  status: AdminSessionStatus;
  userAgentSummary: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  revokedAt?: string;
  revokeReason?: string;
}
