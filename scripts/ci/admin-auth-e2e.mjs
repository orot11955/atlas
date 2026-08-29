import { createHmac } from 'node:crypto';

const baseUrl = process.env.ATLAS_API_BASE_URL ?? 'http://localhost:4000/api';
const email = process.env.ATLAS_OWNER_EMAIL ?? 'owner-ci@atlas.test';
const password = process.env.ATLAS_OWNER_PASSWORD;

if (!password) {
  throw new Error('ATLAS_OWNER_PASSWORD is required.');
}

const initialLogin = await login();
assertEqual(initialLogin.nextStep, 'mfa-setup', 'initial login nextStep');
assertChallenge(initialLogin);

const enrollment = await post(
  '/admin/v1/auth/mfa/totp/enrollment',
  challengeBody(initialLogin),
  200,
);

if (
  typeof enrollment.methodId !== 'string' ||
  typeof enrollment.secret !== 'string' ||
  typeof enrollment.provisioningUri !== 'string' ||
  enrollment.algorithm !== 'SHA1' ||
  enrollment.digits !== 6 ||
  enrollment.period !== 30
) {
  throw new Error('TOTP enrollment response is invalid.');
}

const previousStepCode = generateTotpCode(
  enrollment.secret,
  Math.floor(Date.now() / 30_000) - 1,
);
const confirmation = await post(
  '/admin/v1/auth/mfa/totp/confirm',
  {
    ...challengeBody(initialLogin),
    code: previousStepCode,
  },
  202,
);

assertGrant(confirmation);

if (!Array.isArray(confirmation.recoveryCodes) || confirmation.recoveryCodes.length < 1) {
  throw new Error('TOTP confirmation did not return recovery codes.');
}

const totpLogin = await login();
assertEqual(totpLogin.nextStep, 'mfa', 'post-enrollment login nextStep');

const currentStep = Math.floor(Date.now() / 30_000);
const currentCode = generateTotpCode(enrollment.secret, currentStep);
const verified = await post(
  '/admin/v1/auth/mfa/totp/verify',
  {
    ...challengeBody(totpLogin),
    code: currentCode,
  },
  202,
);
assertGrant(verified);

const replayLogin = await login();
await post(
  '/admin/v1/auth/mfa/totp/verify',
  {
    ...challengeBody(replayLogin),
    code: currentCode,
  },
  401,
);

const recoveryCode = confirmation.recoveryCodes[0];
const recoveryLogin = await login();
const recovered = await post(
  '/admin/v1/auth/mfa/recovery/verify',
  {
    ...challengeBody(recoveryLogin),
    recoveryCode,
  },
  202,
);
assertGrant(recovered);

const recoveryReplayLogin = await login();
await post(
  '/admin/v1/auth/mfa/recovery/verify',
  {
    ...challengeBody(recoveryReplayLogin),
    recoveryCode,
  },
  401,
);

process.stdout.write('Admin password and TOTP MFA E2E passed.\n');

async function login() {
  const data = await post('/admin/v1/auth/login', { email, password }, 202);

  assertChallenge(data);
  return data;
}

async function post(path, body, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  const data = parsed.data ?? parsed;

  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected ${expectedStatus} from ${path}, received ${response.status}: ${text}`,
    );
  }

  return data;
}

function challengeBody(challenge) {
  return {
    challengeId: challenge.challengeId,
    challengeToken: challenge.challengeToken,
  };
}

function assertChallenge(value) {
  if (
    !value ||
    typeof value.challengeId !== 'string' ||
    typeof value.challengeToken !== 'string' ||
    typeof value.expiresAt !== 'string' ||
    !['mfa', 'mfa-setup'].includes(value.nextStep) ||
    !value.challengeToken.startsWith(`atlas_mfa_${value.challengeId}.`)
  ) {
    throw new Error('Password login challenge response is invalid.');
  }
}

function assertGrant(value) {
  if (
    !value ||
    typeof value.grantId !== 'string' ||
    typeof value.grantToken !== 'string' ||
    typeof value.expiresAt !== 'string' ||
    value.nextStep !== 'session' ||
    !value.grantToken.startsWith(`atlas_auth_${value.grantId}.`)
  ) {
    throw new Error('Authentication grant response is invalid.');
  }
}

function assertEqual(actual, expected, name) {
  if (actual !== expected) {
    throw new Error(`${name} must be ${expected}, received ${String(actual)}.`);
  }
}

function generateTotpCode(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, '0');
}

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = value.toUpperCase().replace(/[\s=-]/gu, '');
  let accumulator = 0;
  let bits = 0;
  const output = [];

  for (const character of normalized) {
    const index = alphabet.indexOf(character);

    if (index < 0) {
      throw new Error('Invalid Base32 TOTP secret.');
    }

    accumulator = (accumulator << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >>> bits) & 0xff);
    }
  }

  return Buffer.from(output);
}
