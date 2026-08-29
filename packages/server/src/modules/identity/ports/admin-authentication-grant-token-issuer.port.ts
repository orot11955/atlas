export interface IssuedAdminAuthenticationGrantToken {
  id: string;
  token: string;
  tokenDigest: string;
}

export interface AdminAuthenticationGrantTokenIssuerPort {
  issue(issuedAt: Date): Readonly<IssuedAdminAuthenticationGrantToken>;
  digest(token: string): string;
  matches(token: string, expectedDigest: string): boolean;
}
