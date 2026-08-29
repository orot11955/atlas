import type { AdminMfaAlgorithm } from '../domain/admin-mfa';

export interface AdminTotpParameters {
  algorithm: AdminMfaAlgorithm;
  digits: number;
  periodSeconds: number;
}

export interface CreateAdminTotpProvisioningUriInput extends AdminTotpParameters {
  issuer: string;
  accountName: string;
  secret: string;
}

export interface MatchAdminTotpCodeInput extends AdminTotpParameters {
  secret: string;
  code: string;
  at: Date;
  windowSteps: number;
}

export interface AdminTotpAuthenticatorPort {
  generateSecret(): string;
  createProvisioningUri(input: CreateAdminTotpProvisioningUriInput): string;
  matchCode(input: MatchAdminTotpCodeInput): number | undefined;
}
