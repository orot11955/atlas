export interface IssuedAdminRecoveryCode {
  code: string;
  digest: string;
}

export interface AdminRecoveryCodeIssuerPort {
  issue(count: number): readonly Readonly<IssuedAdminRecoveryCode>[];
  digest(code: string): string;
}
