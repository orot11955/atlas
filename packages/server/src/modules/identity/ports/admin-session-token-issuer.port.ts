export interface IssuedAdminSessionToken {
  id: string;
  token: string;
  tokenDigest: string;
  csrfToken: string;
  csrfTokenDigest: string;
}

export interface AdminSessionTokenIssuerPort {
  issue(issuedAt: Date): Readonly<IssuedAdminSessionToken>;
  parseSessionToken(token: string): Readonly<{ id: string }> | undefined;
  digestSessionToken(token: string): string;
  matchesSessionToken(token: string, expectedDigest: string): boolean;
  digestCsrfToken(token: string): string;
  matchesCsrfToken(token: string, expectedDigest: string): boolean;
}
