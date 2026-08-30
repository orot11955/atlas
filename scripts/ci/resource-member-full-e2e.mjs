import { createHmac } from 'node:crypto';

import { verifyResourceMemberDirectory } from './resource-member-e2e.mjs';

const baseUrl = process.env.ATLAS_API_BASE_URL ?? 'http://localhost:4000/api';
const email = process.env.ATLAS_OWNER_EMAIL ?? 'owner-phase5@atlas.test';
const password = process.env.ATLAS_OWNER_PASSWORD;
const sessionCookieName = process.env.AUTH_SESSION_COOKIE_NAME ?? 'atlas_admin_session';
const csrfCookieName = process.env.AUTH_CSRF_COOKIE_NAME ?? 'atlas_admin_csrf';

if (!password) throw new Error('ATLAS_OWNER_PASSWORD is required.');

const login = await request('/admin/v1/auth/login', {
  method: 'POST',
  body: { email, password },
  expectedStatus: 202,
});
assertChallenge(login.data);

const enrollment = await request('/admin/v1/auth/mfa/totp/enrollment', {
  method: 'POST',
  body: challengeBody(login.data),
  expectedStatus: 200,
});
const secret = enrollment.data.secret;
if (typeof secret !== 'string') throw new Error('TOTP secret was not returned.');

const code = generateTotpCode(secret, Math.floor(Date.now() / 30_000) - 1);
const confirmation = await request('/admin/v1/auth/mfa/totp/confirm', {
  method: 'POST',
  body: { ...challengeBody(login.data), code },
  expectedStatus: 202,
});
assertGrant(confirmation.data);

const session = await createSession(confirmation.data);
const mainBlog = (
  await request('/admin/v1/sites', {
    method: 'POST',
    body: {
      key: 'phase5-main-blog',
      name: 'Phase 5 Main Blog',
      type: 'blog',
      timezone: 'Asia/Seoul',
      locale: 'ko-KR',
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  })
).data;
const devLog = (
  await request('/admin/v1/sites', {
    method: 'POST',
    body: {
      key: 'phase5-dev-log',
      name: 'Phase 5 Dev Log',
      type: 'blog',
      timezone: 'Asia/Seoul',
      locale: 'ko-KR',
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  })
).data;

await request('/admin/v1/projects', {
  method: 'POST',
  body: {
    key: 'phase5-atlas',
    name: 'Phase 5 Atlas',
    description: 'Project relation target for Resource Directory E2E.',
    siteIds: [mainBlog.id, devLog.id],
  },
  expectedStatus: 201,
  cookieHeader: session.cookieHeader,
  csrfToken: session.csrfToken,
});

await verifyResourceMemberDirectory({
  request,
  session,
  mainBlog,
  devLog,
  assertEqual,
});

process.stdout.write('Resource and Member Directory E2E passed.\n');

async function createSession(grant) {
  const response = await request('/admin/v1/auth/session', {
    method: 'POST',
    body: { grantId: grant.grantId, grantToken: grant.grantToken },
    expectedStatus: 201,
  });
  const pairs = response.response.headers.getSetCookie().map((value) => value.split(';', 1)[0]);
  const sessionCookie = pairs.find((value) => value.startsWith(`${sessionCookieName}=`));
  const csrfCookie = pairs.find((value) => value.startsWith(`${csrfCookieName}=`));
  if (!sessionCookie || !csrfCookie) throw new Error('Session cookies were not returned.');
  return {
    cookieHeader: pairs.join('; '),
    csrfToken: decodeURIComponent(csrfCookie.slice(csrfCookie.indexOf('=') + 1)),
  };
}

async function request(
  path,
  { method = 'GET', body, expectedStatus, cookieHeader, csrfToken } = {},
) {
  const headers = new Headers({ accept: 'application/json' });
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (cookieHeader) headers.set('cookie', cookieHeader);
  if (csrfToken) headers.set('x-csrf-token', csrfToken);
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = {};
  if (text) parsed = JSON.parse(text);
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected ${expectedStatus} from ${method} ${path}, received ${response.status}: ${text}`,
    );
  }
  return { response, data: parsed.data ?? parsed };
}

function challengeBody(challenge) {
  return {
    challengeId: challenge.challengeId,
    challengeToken: challenge.challengeToken,
  };
}

function assertChallenge(value) {
  if (!value || typeof value.challengeId !== 'string' || typeof value.challengeToken !== 'string') {
    throw new Error('Password challenge response is invalid.');
  }
}

function assertGrant(value) {
  if (!value || typeof value.grantId !== 'string' || typeof value.grantToken !== 'string') {
    throw new Error('Authentication Grant response is invalid.');
  }
}

function assertEqual(actual, expected, name) {
  if (actual !== expected) {
    throw new Error(`${name} must be ${String(expected)}, received ${String(actual)}.`);
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
    if (index < 0) throw new Error('Invalid Base32 Secret.');
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >>> bits) & 0xff);
    }
  }
  return Buffer.from(output);
}
