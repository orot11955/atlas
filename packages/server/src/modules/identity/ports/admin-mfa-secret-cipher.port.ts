export interface EncryptedAdminMfaSecret {
  encryptedValue: string;
  keyVersion: string;
}

export interface AdminMfaSecretCipherPort {
  encrypt(plaintext: string): Readonly<EncryptedAdminMfaSecret>;
  decrypt(encryptedValue: string, keyVersion: string): string;
}
