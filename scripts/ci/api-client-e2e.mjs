export async function runApiClientE2e({
  baseUrl,
  request,
  session,
  workspace,
  site,
}) {
  const activated = await request(`/admin/v1/sites/${site.id}/activate`, {
    method: 'POST',
    body: { version: site.version },
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  const activeSite = activated.data;

  const deliveryInput = {
    name: 'CI Delivery Client',
    description: 'Delivery authentication E2E',
    type: 'delivery',
    rateLimitPerMinute: 100,
    requireOrigin: true,
    siteIds: [activeSite.id],
    scopes: ['site:read', 'content:read', 'feed:read'],
    allowedOrigins: ['https://blog.atlas.test'],
  };

  await request('/admin/v1/api-clients', {
    method: 'POST',
    body: deliveryInput,
    expectedStatus: 403,
    cookieHeader: session.cookieHeader,
  });

  const created = await request('/admin/v1/api-clients', {
    method: 'POST',
    body: deliveryInput,
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  let deliveryClient = created.data.client;
  const originalCredential = created.data.credential;

  assertApiClient(deliveryClient, 'delivery', 'active');
  assertCredential(originalCredential);
  assertEqual(deliveryClient.workspaceId, workspace.id, 'API Client Workspace');
  assertEqual(
    JSON.stringify(deliveryClient).includes(originalCredential.apiKey),
    false,
    'API Client response raw Key leak',
  );

  const listed = await request(
    `/admin/v1/api-clients?siteId=${encodeURIComponent(activeSite.id)}&type=delivery&status=active`,
    {
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
    },
  );
  assertEqual(listed.data.length, 1, 'Filtered API Client count');
  assertEqual(
    JSON.stringify(listed.data).includes(originalCredential.apiKey),
    false,
    'API Client list raw Key leak',
  );

  await deliveryRequest(baseUrl, activeSite.key, {
    expectedStatus: 401,
  });
  await deliveryRequest(baseUrl, activeSite.key, {
    apiKey: originalCredential.apiKey,
    expectedStatus: 403,
  });
  await deliveryRequest(baseUrl, activeSite.key, {
    apiKey: originalCredential.apiKey,
    origin: 'https://other.atlas.test',
    expectedStatus: 403,
  });
  await deliveryRequest(baseUrl, 'main-blog', {
    apiKey: originalCredential.apiKey,
    origin: 'https://blog.atlas.test',
    expectedStatus: 403,
  });

  const delivered = await deliveryRequest(baseUrl, activeSite.key, {
    apiKey: originalCredential.apiKey,
    origin: 'https://blog.atlas.test',
    expectedStatus: 200,
  });
  assertEqual(delivered.data.key, activeSite.key, 'Delivered Site key');
  assertEqual(delivered.data.name, activeSite.name, 'Delivered Site name');

  const rotated = await request(
    `/admin/v1/api-clients/${deliveryClient.id}/keys/rotate`,
    {
      method: 'POST',
      body: { gracePeriodSeconds: 120 },
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    },
  );
  deliveryClient = rotated.data.client;
  const rotatedCredential = rotated.data.credential;
  assertCredential(rotatedCredential);

  await deliveryRequest(baseUrl, activeSite.key, {
    apiKey: originalCredential.apiKey,
    origin: 'https://blog.atlas.test',
    expectedStatus: 200,
  });
  await deliveryRequest(baseUrl, activeSite.key, {
    apiKey: rotatedCredential.apiKey,
    origin: 'https://blog.atlas.test',
    expectedStatus: 200,
  });

  const revokedOld = await request(
    `/admin/v1/api-clients/${deliveryClient.id}/keys/${originalCredential.keyId}/revoke`,
    {
      method: 'POST',
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    },
  );
  deliveryClient = revokedOld.data;
  await deliveryRequest(baseUrl, activeSite.key, {
    apiKey: originalCredential.apiKey,
    origin: 'https://blog.atlas.test',
    expectedStatus: 401,
  });

  await deliveryRequest(baseUrl, activeSite.key, {
    apiKey: rotatedCredential.apiKey,
    origin: 'https://blog.atlas.test',
    expectedStatus: 200,
  });
  const detail = await request(
    `/admin/v1/api-clients/${deliveryClient.id}`,
    {
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
    },
  );
  const currentKey = detail.data.keys.find(
    (key) => key.id === rotatedCredential.keyId,
  );

  if (!currentKey?.lastUsedAt) {
    throw new Error('API Client Key lastUsedAt was not recorded.');
  }

  const disabled = await request(
    `/admin/v1/api-clients/${deliveryClient.id}/disable`,
    {
      method: 'POST',
      body: { version: detail.data.version },
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    },
  );
  deliveryClient = disabled.data;
  assertApiClient(deliveryClient, 'delivery', 'disabled');
  await deliveryRequest(baseUrl, activeSite.key, {
    apiKey: rotatedCredential.apiKey,
    origin: 'https://blog.atlas.test',
    expectedStatus: 401,
  });

  const enabled = await request(
    `/admin/v1/api-clients/${deliveryClient.id}/enable`,
    {
      method: 'POST',
      body: { version: deliveryClient.version },
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    },
  );
  deliveryClient = enabled.data;
  await deliveryRequest(baseUrl, activeSite.key, {
    apiKey: rotatedCredential.apiKey,
    origin: 'https://blog.atlas.test',
    expectedStatus: 200,
  });

  const integration = await request('/admin/v1/api-clients', {
    method: 'POST',
    body: {
      name: 'CI Integration Client',
      type: 'integration',
      rateLimitPerMinute: 100,
      requireOrigin: false,
      siteIds: [activeSite.id],
      scopes: ['deployment:create', 'deployment:update'],
      allowedOrigins: [],
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  assertApiClient(integration.data.client, 'integration', 'active');
  await deliveryRequest(baseUrl, activeSite.key, {
    apiKey: integration.data.credential.apiKey,
    expectedStatus: 403,
  });

  const rateLimited = await request('/admin/v1/api-clients', {
    method: 'POST',
    body: {
      name: 'CI Rate Limited Delivery',
      type: 'delivery',
      rateLimitPerMinute: 2,
      requireOrigin: false,
      siteIds: [activeSite.id],
      scopes: ['site:read'],
      allowedOrigins: [],
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  const rateKey = rateLimited.data.credential.apiKey;
  await deliveryRequest(baseUrl, activeSite.key, {
    apiKey: rateKey,
    expectedStatus: 200,
  });
  await deliveryRequest(baseUrl, activeSite.key, {
    apiKey: rateKey,
    expectedStatus: 200,
  });
  const limited = await deliveryRequest(baseUrl, activeSite.key, {
    apiKey: rateKey,
    expectedStatus: 429,
  });

  if (!limited.response.headers.get('retry-after')) {
    throw new Error('Rate-limited Delivery response did not include Retry-After.');
  }

  const archived = await request(
    `/admin/v1/api-clients/${deliveryClient.id}/archive`,
    {
      method: 'POST',
      body: { version: deliveryClient.version },
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    },
  );
  assertApiClient(archived.data, 'delivery', 'archived');
  await deliveryRequest(baseUrl, activeSite.key, {
    apiKey: rotatedCredential.apiKey,
    origin: 'https://blog.atlas.test',
    expectedStatus: 401,
  });

  process.stdout.write(
    'API Client creation, rotation, revocation, Origin, Site Scope and Delivery authentication E2E passed.\n',
  );
}

async function deliveryRequest(
  baseUrl,
  siteKey,
  { apiKey, origin, expectedStatus },
) {
  const headers = new Headers({ accept: 'application/json' });

  if (apiKey) {
    headers.set('authorization', `Bearer ${apiKey}`);
  }
  if (origin) {
    headers.set('origin', origin);
  }

  const response = await fetch(
    `${baseUrl}/delivery/v1/sites/${encodeURIComponent(siteKey)}`,
    { headers },
  );
  const text = await response.text();
  let parsed = {};

  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Delivery response is not JSON: ${text}`);
    }
  }

  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected ${expectedStatus} from Delivery Site ${siteKey}, received ${response.status}: ${text}`,
    );
  }

  return { response, data: parsed.data ?? parsed };
}

function assertApiClient(value, type, status) {
  if (
    !value ||
    typeof value.id !== 'string' ||
    value.type !== type ||
    value.status !== status ||
    !Array.isArray(value.siteIds) ||
    !Array.isArray(value.scopes) ||
    !Array.isArray(value.keys) ||
    typeof value.version !== 'number'
  ) {
    throw new Error(`API Client response is invalid for ${type}/${status}.`);
  }
}

function assertCredential(value) {
  if (
    !value ||
    typeof value.keyId !== 'string' ||
    typeof value.keyPrefix !== 'string' ||
    typeof value.apiKey !== 'string' ||
    !value.apiKey.startsWith(`atlas_live_${value.keyId}.`)
  ) {
    throw new Error('API Client Credential response is invalid.');
  }
}

function assertEqual(actual, expected, name) {
  if (actual !== expected) {
    throw new Error(
      `${name} must be ${String(expected)}, received ${String(actual)}.`,
    );
  }
}
