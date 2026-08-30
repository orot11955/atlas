export interface IssuedApiClientKey {
  id: string;
  apiKey: string;
  keyPrefix: string;
  secretDigest: string;
}

export interface ParsedApiClientKey {
  id: string;
  keyPrefix: string;
  secret: string;
}

export interface ApiClientKeyIssuerPort {
  issue(issuedAt: Date): Readonly<IssuedApiClientKey>;
  parse(apiKey: string): Readonly<ParsedApiClientKey> | undefined;
  matches(apiKey: string, expectedDigest: string): boolean;
}
