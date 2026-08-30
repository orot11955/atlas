import { createHmac } from 'node:crypto';

import { verifyApiClientLifecycle } from './api-client-lifecycle-e2e.mjs';
import { verifyProjectDeploymentReadModel } from './project-deployment-e2e.mjs';

const baseUrl = process.env.ATLAS_API_BASE_URL ?? 'http://localhost:4000/api';
const email = process.env.ATLAS_OWNER_EMAIL ?? 'owner-ci@atlas.test';
const password = process.env.ATLAS_OWNER_PASSWORD;
const sessionCookieName = process.env.AUTH_SESSION_COOKIE_NAME ?? 'atlas_admin_session';
const csrfCookieName = process.env.AUTH_CSRF_COOKIE_NAME ?? 'atlas_admin_csrf';

if (!password) {
  throw new Error('ATLAS_OWNER_PASSWORD is required.');
}

const initialLogin = await login();
assertEqual(initialLogin.nextStep, 'mfa-setup', 'initial login nextStep');
assertChallenge(initialLogin);

const enrollment = await request('/admin/v1/auth/mfa/totp/enrollment', {
  method: 'POST',
  body: challengeBody(initialLogin),
  expectedStatus: 200,
});

if (
  typeof enrollment.data.methodId !== 'string' ||
  typeof enrollment.data.secret !== 'string' ||
  typeof enrollment.data.provisioningUri !== 'string' ||
  enrollment.data.algorithm !== 'SHA1' ||
  enrollment.data.digits !== 6 ||
  enrollment.data.period !== 30
) {
  throw new Error('TOTP enrollment response is invalid.');
}

const previousStepCode = generateTotpCode(
  enrollment.data.secret,
  Math.floor(Date.now() / 30_000) - 1,
);
const confirmation = await request('/admin/v1/auth/mfa/totp/confirm', {
  method: 'POST',
  body: {
    ...challengeBody(initialLogin),
    code: previousStepCode,
  },
  expectedStatus: 202,
});

assertGrant(confirmation.data);

if (!Array.isArray(confirmation.data.recoveryCodes) || confirmation.data.recoveryCodes.length < 1) {
  throw new Error('TOTP confirmation did not return recovery codes.');
}

const session = await createSession(confirmation.data);
await request('/admin/v1/auth/session', {
  expectedStatus: 200,
  cookieHeader: session.cookieHeader,
});
await request('/admin/v1/workspace', { expectedStatus: 401 });

const workspaceResponse = await request('/admin/v1/workspace', {
  expectedStatus: 200,
  cookieHeader: session.cookieHeader,
});
const workspace = workspaceResponse.data;

if (
  typeof workspace.id !== 'string' ||
  workspace.key !== 'default' ||
  workspace.timezone !== 'Asia/Seoul' ||
  typeof workspace.version !== 'number'
) {
  throw new Error('Default Workspace response is invalid.');
}

await request('/admin/v1/workspace', {
  method: 'PATCH',
  body: {
    version: workspace.version,
    name: 'Atlas CI Workspace',
    timezone: 'Asia/Seoul',
    locale: 'ko-KR',
  },
  expectedStatus: 403,
  cookieHeader: session.cookieHeader,
});

const updatedWorkspace = await request('/admin/v1/workspace', {
  method: 'PATCH',
  body: {
    version: workspace.version,
    name: 'Atlas CI Workspace',
    timezone: 'Asia/Seoul',
    locale: 'ko-KR',
  },
  expectedStatus: 200,
  cookieHeader: session.cookieHeader,
  csrfToken: session.csrfToken,
});
assertEqual(updatedWorkspace.data.version, workspace.version + 1, 'Workspace version');

const mainBlogInput = {
  key: 'main-blog',
  name: 'Main Blog',
  description: 'Atlas CI main Blog',
  type: 'blog',
  timezone: 'Asia/Seoul',
  locale: 'ko-KR',
  canonicalDomain: 'main-blog.atlas.test',
};

await request('/admin/v1/sites', {
  method: 'POST',
  body: mainBlogInput,
  expectedStatus: 403,
  cookieHeader: session.cookieHeader,
});

const mainBlogCreated = await request('/admin/v1/sites', {
  method: 'POST',
  body: mainBlogInput,
  expectedStatus: 201,
  cookieHeader: session.cookieHeader,
  csrfToken: session.csrfToken,
});
let mainBlog = mainBlogCreated.data;
assertSite(mainBlog, 'main-blog', 'draft');
assertEqual(
  mainBlog.canonicalDomain?.verificationStatus,
  'pending',
  'Canonical Domain verification status',
);

await request('/admin/v1/sites', {
  method: 'POST',
  body: {
    ...mainBlogInput,
    name: 'Duplicate Main Blog',
    canonicalDomain: 'duplicate.atlas.test',
  },
  expectedStatus: 409,
  cookieHeader: session.cookieHeader,
  csrfToken: session.csrfToken,
});

await request('/admin/v1/sites', {
  method: 'POST',
  body: {
    ...mainBlogInput,
    key: 'dev-log',
    name: 'Dev Log',
  },
  expectedStatus: 409,
  cookieHeader: session.cookieHeader,
  csrfToken: session.csrfToken,
});

const devLogCreated = await request('/admin/v1/sites', {
  method: 'POST',
  body: {
    key: 'dev-log',
    name: 'Dev Log',
    description: 'Atlas CI development log',
    type: 'blog',
    timezone: 'Asia/Seoul',
    locale: 'ko-KR',
    canonicalDomain: 'dev-log.atlas.test',
  },
  expectedStatus: 201,
  cookieHeader: session.cookieHeader,
  csrfToken: session.csrfToken,
});
assertSite(devLogCreated.data, 'dev-log', 'draft');

const draftSites = await request('/admin/v1/sites?status=draft&type=blog&limit=10', {
  expectedStatus: 200,
  cookieHeader: session.cookieHeader,
});

if (
  !Array.isArray(draftSites.data.items) ||
  draftSites.data.items.length !== 2 ||
  draftSites.data.items.some((site) => site.workspaceId !== workspace.id)
) {
  throw new Error('Workspace-scoped Site list is invalid.');
}

const updatedMainBlog = await request(`/admin/v1/sites/${mainBlog.id}`, {
  method: 'PATCH',
  body: {
    version: mainBlog.version,
    name: 'Main Blog',
    description: 'Updated by Atlas CI',
    type: 'blog',
    timezone: 'Asia/Seoul',
    locale: 'ko-KR',
    canonicalDomain: 'main-blog.atlas.test',
  },
  expectedStatus: 200,
  cookieHeader: session.cookieHeader,
  csrfToken: session.csrfToken,
});
mainBlog = updatedMainBlog.data;
assertEqual(mainBlog.version, 2, 'Updated Site version');

mainBlog = (await transitionSite(mainBlog, 'activate', 'active', session)).data;

await verifyApiClientLifecycle({
  request,
  session,
  mainBlog,
  devLog: devLogCreated.data,
  transitionSite,
  assertEqual,
});

await verifyProjectDeploymentReadModel({
  request,
  session,
  mainBlog,
  devLog: devLogCreated.data,
  assertEqual,
});

mainBlog = (await transitionSite(mainBlog, 'maintenance', 'maintenance', session)).data;

await request(`/admin/v1/sites/${mainBlog.id}/archive`, {
  method: 'POST',
  body: { version: mainBlog.version },
  expectedStatus: 409,
  cookieHeader: session.cookieHeader,
  csrfToken: session.csrfToken,
});

mainBlog = (await transitionSite(mainBlog, 'disable', 'disabled', session)).data;
mainBlog = (await transitionSite(mainBlog, 'archive', 'archived', session)).data;

await request(`/admin/v1/sites/${mainBlog.id}`, {
  method: 'PATCH',
  body: {
    version: mainBlog.version,
    name: 'Archived Site Cannot Change',
    type: 'blog',
    timezone: 'Asia/Seoul',
    locale: 'ko-KR',
  },
  expectedStatus: 403,
  cookieHeader: session.cookieHeader,
  csrfToken: session.csrfToken,
});

const archivedSites = await request('/admin/v1/sites?status=archived&limit=10', {
  expectedStatus: 200,
  cookieHeader: session.cookieHeader,
});
assertEqual(archivedSites.data.items.length, 1, 'Archived Site list count');
assertEqual(archivedSites.data.items[0]?.id, mainBlog.id, 'Archived Site ID');

const totpLogin = await login();
assertEqual(totpLogin.nextStep, 'mfa', 'post-enrollment login nextStep');

const currentStep = Math.floor(Date.now() / 30_000);
const currentCode = generateTotpCode(enrollment.data.secret, currentStep);
const verified = await request('/admin/v1/auth/mfa/totp/verify', {
  method: 'POST',
  body: {
    ...challengeBody(totpLogin),
    code: currentCode,
  },
  expectedStatus: 202,
});
assertGrant(verified.data);

const replayLogin = await login();
await request('/admin/v1/auth/mfa/totp/verify', {
  method: 'POST',
  body: {
    ...challengeBody(replayLogin),
    code: currentCode,
  },
  expectedStatus: 401,
});

const recoveryCode = confirmation.data.recoveryCodes[0];
const recoveryLogin = await login();
const recovered = await request('/admin/v1/auth/mfa/recovery/verify', {
  method: 'POST',
  body: {
    ...challengeBody(recoveryLogin),
    recoveryCode,
  },
  expectedStatus: 202,
});
assertGrant(recovered.data);

const recoveryReplayLogin = await login();
await request('/admin/v1/auth/mfa/recovery/verify', {
  method: 'POST',
  body: {
    ...challengeBody(recoveryReplayLogin),
    recoveryCode,
  },
  expectedStatus: 401,
});

process.stdout.write(
  'Admin Password, TOTP, Session, Workspace, Site, API Client, Project and Deployment E2E passed.\n',
);

async function login() {
  const response = await request('/admin/v1/auth/login', {
    method: 'POST',
    body: { email, password },
    expectedStatus: 202,
  });

  assertChallenge(response.data);
  return response.data;
}

async function createSession(grant) {
  const response = await request('/admin/v1/auth/session', {
    method: 'POST',
    body: {
      grantId: grant.grantId,
      grantToken: grant.grantToken,
    },
    expectedStatus: 201,
  });
  const setCookies = response.response.headers.getSetCookie();
  const cookiePairs = setCookies.map((value) => value.split(';', 1)[0]);
  const sessionCookie = cookiePairs.find((value) => value.startsWith(`${sessionCookieName}=`));
  const csrfCookie = cookiePairs.find((value) => value.startsWith(`${csrfCookieName}=`));

  if (!sessionCookie || !csrfCookie) {
    throw new Error(`Session response did not set both cookies: ${setCookies.join(' | ')}`);
  }

  return {
    data: response.data,
    cookieHeader: cookiePairs.join('; '),
    csrfToken: decodeURIComponent(csrfCookie.slice(csrfCookie.indexOf('=') + 1)),
  };
}

async function transitionSite(site, action, expectedStatus, session) {
  const response = await request(`/admin/v1/sites/${site.id}/${action}`, {
    method: 'POST',
    body: { version: site.version },
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  assertSite(response.data, site.key, expectedStatus);
  assertEqual(response.data.version, site.version + 1, `${expectedStatus} Site version`);
  return response;
}

async function request(
  path,
  {
    method = 'GET',
    body,
    expectedStatus,
    cookieHeader,
    csrfToken,
    authorization,
    origin,
    idempotencyKey,
  },
) {
  const headers = new Headers({ accept: 'application/json' });

  if (body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  if (cookieHeader) {
    headers.set('cookie', cookieHeader);
  }
  if (csrfToken) {
    headers.set('x-csrf-token', csrfToken);
  }
  if (authorization) {
    headers.set('authorization', authorization);
  }
  if (origin) {
    headers.set('origin', origin);
  }
  if (idempotencyKey) {
    headers.set('idempotency-key', idempotencyKey);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = {};

  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Response from ${path} is not valid JSON: ${text}`);
    }
  }

  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected ${expectedStatus} from ${method} ${path}, received ${response.status}: ${text}`,
    );
  }

  return {
    response,
    data: parsed.data ?? parsed,
  };
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

function assertSite(value, key, status) {
  if (
    !value ||
    typeof value.id !== 'string' ||
    value.key !== key ||
    value.status !== status ||
    typeof value.version !== 'number' ||
    typeof value.workspaceId !== 'string'
  ) {
    throw new Error(`Site response is invalid for ${key}/${status}.`);
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
