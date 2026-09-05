export interface EncryptedWebhookSecret {
  encryptedValue: string;
  keyVersion: string;
}

export interface WebhookSecretCipherPort {
  encrypt(plaintext: string): Readonly<EncryptedWebhookSecret>;
  decrypt(encryptedValue: string, keyVersion: string): string;
}
