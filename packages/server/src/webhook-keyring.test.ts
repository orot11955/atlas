import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import { inspect } from 'node:util';
import { test } from 'node:test';
import { Aes256GcmWebhookSecretCipher as Cipher } from './modules/eventing/infrastructure/crypto/aes256-gcm-webhook-secret-cipher';

const oldKey = Buffer.alloc(32, 0x13).toString('base64');
const newKey = Buffer.alloc(32, 0x27).toString('base64');
const secret = 'signature-secret-retained-through-storage-rotation';
const previous = JSON.stringify([{ version: 'v1', keyBase64: oldKey }]);
const keyring = () => new Cipher(newKey, 'v2', previous);

// Independent w1/AAD reference: this is the pre-keyring encryption contract.
function legacyEncrypt(keyBase64: string, version: string, aadDomain = 'atlas.webhook-secret') {
  const iv = Buffer.alloc(12, 0x5a);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv, {
    authTagLength: 16,
  });
  cipher.setAAD(Buffer.from(`${aadDomain}\u0000${version}`, 'utf8'));
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [
    'w1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join('.');
}
function legacyDecrypt(value: string, keyBase64: string, version: string): string {
  const parts = value.split('.');
  assert.equal(parts.length, 4);
  assert.equal(parts[0], 'w1');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(keyBase64, 'base64'),
    Buffer.from(parts[1]!, 'base64url'),
    { authTagLength: 16 },
  );
  decipher.setAAD(Buffer.from(`atlas.webhook-secret\u0000${version}`, 'utf8'));
  decipher.setAuthTag(Buffer.from(parts[2]!, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[3]!, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

test('old w1 ciphertext remains readable after changing the active key', () => {
  assert.equal(keyring().decrypt(legacyEncrypt(oldKey, 'v1'), 'v1'), secret);
});

test('new writes use only the active key and retain the legacy format', () => {
  const result = keyring().encrypt(secret);
  assert.equal(result.keyVersion, 'v2');
  assert.equal(legacyDecrypt(result.encryptedValue, newKey, 'v2'), secret);
  assert.throws(() => new Cipher(oldKey, 'v1').decrypt(result.encryptedValue, 'v2'));
  assert.ok(Object.isFrozen(result));
});

test('future keys can be preloaded without changing the active write key', () => {
  const preloaded = new Cipher(
    oldKey,
    'v1',
    JSON.stringify([{ version: 'v2', keyBase64: newKey }]),
  );
  assert.equal(preloaded.encrypt(secret).keyVersion, 'v1');
  const next = keyring().encrypt(secret);
  assert.equal(preloaded.decrypt(next.encryptedValue, 'v2'), secret);
});

test('unknown key versions do not fall back to another key', () => {
  assert.throws(() => keyring().decrypt(legacyEncrypt(oldKey, 'v1'), 'missing'), /not available/u);
});

test('stored version changes and same-version wrong key bytes fail authentication', () => {
  const ciphertext = legacyEncrypt(oldKey, 'v1');
  assert.throws(() => keyring().decrypt(ciphertext, 'v2'), /authentication failed/u);
  assert.throws(() => new Cipher(newKey, 'v1').decrypt(ciphertext, 'v1'), /authentication failed/u);
});

test('Webhook AAD does not accept an MFA-domain ciphertext', () => {
  assert.throws(() => keyring().decrypt(legacyEncrypt(oldKey, 'v1', 'atlas.admin-mfa'), 'v1'));
});

test('storage-key rotation preserves the HMAC signing secret and exact signature', () => {
  const original = legacyEncrypt(oldKey, 'v1');
  const plaintext = keyring().decrypt(original, 'v1');
  const updated = keyring().encrypt(plaintext);
  const sign = (value: string) =>
    createHmac('sha256', value).update('timestamp.event.body').digest('hex');
  assert.equal(sign(keyring().decrypt(updated.encryptedValue, 'v2')), sign(secret));
});

test('keys cannot escape through ordinary JSON or object inspection', () => {
  const cipher = keyring();
  const text = `${JSON.stringify(cipher)} ${inspect(cipher, { showHidden: true, depth: null })}`;
  for (const forbidden of [oldKey, newKey, secret]) assert.ok(!text.includes(forbidden));
  assert.equal(JSON.stringify(cipher), '{}');
});

test('readable key versions are defensive and immutable', () => {
  const cipher = keyring();
  const versions = cipher.readableVersions;
  assert.deepEqual(versions, ['v2', 'v1']);
  assert.ok(Object.isFrozen(versions));
  assert.notEqual(cipher.readableVersions, versions);
  assert.throws(() => (versions as string[]).push('x'));
});

test('repeated encryption produces distinct IVs without changing plaintext', () => {
  const cipher = keyring();
  const ivs = new Set<string>();
  for (let i = 0; i < 128; i += 1) {
    const result = cipher.encrypt(secret);
    const parts = result.encryptedValue.split('.');
    assert.equal(Buffer.from(parts[1]!, 'base64url').length, 12);
    assert.equal(Buffer.from(parts[2]!, 'base64url').length, 16);
    ivs.add(parts[1]!);
    assert.equal(cipher.decrypt(result.encryptedValue, result.keyVersion), secret);
  }
  assert.equal(ivs.size, 128);
});

for (const position of [1, 2, 3]) {
  test(`tampering with ciphertext component ${position} is rejected`, () => {
    const parts = legacyEncrypt(oldKey, 'v1').split('.');
    const decoded = Buffer.from(parts[position]!, 'base64url');
    decoded[0] = decoded[0]! ^ 1;
    parts[position] = decoded.toString('base64url');
    assert.throws(() => keyring().decrypt(parts.join('.'), 'v1'));
  });
}

const invalidLists: [string, unknown][] = [
  ['invalid JSON', '{secret-marker'],
  ['object', '{}'],
  ['null', 'null'],
  ['missing properties', '[{}]'],
  ['array entry', '[[]]'],
  ['non-string key', '[{"version":"v0","keyBase64":1}]'],
  ['missing version', JSON.stringify([{ keyBase64: oldKey }])],
  ['extra property', JSON.stringify([{ version: 'v1', keyBase64: oldKey, extra: true }])],
  ['duplicate active version', JSON.stringify([{ version: 'v2', keyBase64: oldKey }])],
  ['normalized duplicate version', JSON.stringify([{ version: ' v2 ', keyBase64: oldKey }])],
  [
    'duplicate decrypt version',
    JSON.stringify([
      { version: 'v1', keyBase64: oldKey },
      { version: 'v1', keyBase64: oldKey },
    ]),
  ],
  ['duplicate active key material', JSON.stringify([{ version: 'v1', keyBase64: newKey }])],
  [
    'duplicate old key material',
    JSON.stringify([
      { version: 'v1', keyBase64: oldKey },
      { version: 'v0', keyBase64: oldKey },
    ]),
  ],
  ['bad version', JSON.stringify([{ version: 'bad version', keyBase64: oldKey }])],
  ['bad base64', JSON.stringify([{ version: 'v1', keyBase64: 'secret-marker' }])],
  ['oversize list', ' '.repeat(8193)],
  [
    'too many keys',
    JSON.stringify(
      Array.from({ length: 9 }, (_, i) => ({
        version: `old-${i}`,
        keyBase64: Buffer.alloc(32, i + 40).toString('base64'),
      })),
    ),
  ],
  ['non-string input', 17],
];
for (const [name, value] of invalidLists) {
  test(`invalid key configuration fails without leaking the value: ${name}`, () => {
    assert.throws(
      () => new Cipher(newKey, 'v2', value as string),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /secret-marker/u);
        assert.ok(!error.message.includes(oldKey));
        assert.ok(!error.message.includes(newKey));
        return true;
      },
    );
  });
}

test('legacy two-argument composition remains compatible', () => {
  const cipher = new Cipher(oldKey, ' v1 ');
  assert.equal(cipher.activeVersion, 'v1');
  assert.equal(cipher.decrypt(legacyEncrypt(oldKey, 'v1'), 'v1'), secret);
});

test('ciphertext length and structural validation remain bounded', () => {
  for (const value of ['', 'w0.x.x.x', 'w1.x.x.x.extra', 'x'.repeat(32769)]) {
    assert.throws(() => keyring().decrypt(value, 'v1'));
  }
});

test('non-ASCII maximum-length legacy secrets remain supported', () => {
  const value = '한'.repeat(4096);
  const cipher = keyring();
  const result = cipher.encrypt(value);
  assert.equal(cipher.decrypt(result.encryptedValue, result.keyVersion), value);
  for (const invalid of ['', 'x'.repeat(31), 'x'.repeat(4097)]) {
    assert.throws(() => cipher.encrypt(invalid));
  }
});
