export interface IssuedAdminLoginChallengeToken {
  id: string;
  token: string;
  tokenDigest: string;
}

export interface AdminLoginChallengeTokenIssuerPort {
  issue(issuedAt: Date): Readonly<IssuedAdminLoginChallengeToken>;
  digest(token: string): string;
  matches(token: string, expectedDigest: string): boolean;
}
