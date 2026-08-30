export async function verifyApiClientLifecycle({
  request,
  session,
  mainBlog,
  devLog,
  transitionSite,
  assertEqual,
}) {
  const activeDevLog = (
    await transitionSite(devLog, 'activate', 'active', session)
  ).data;
  const origin = 'https://blog.atlas.test';
  const createInput = {
    name: 'Main Blog Delivery',
    description: 'Atlas CI Delivery client',
    type: 'delivery',
    rateLimitPerMinute: 100,
    requireOrigin: true,
    siteIds: [mainBlog.id],
    scopes: ['site:read', 'content:read', 'feed:read'],
    allowedOrigins: [origin],
  };

  await request('/admin/v1/api-clients', {
    method: 'POST',
    body: createInput,
    expectedStatus: 403,
    cookieHeader: session.cookieHeader,
  });

  const created = await request('/admin/v1/api-clients', {
    method: 'POST',
    body: createInput,
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  let client = created.data.client;
  let credential = created.data.credential;
  assertApiClient(client, 'delivery', 'active');
  assertCredential(credential);
  assertEqual(client.version, 1, 'Created API Client version');
  assertNoRawKey(client, credential.apiKey, 'create response client');

  const listed = await request(
    `/admin/v1/api-clients?siteId=${encodeURIComponent(mainBlog.id)}&type=delivery`,
    {
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
    },
  );

  if (!Array.isArray(listed.data) || listed.data.length !== 1) {
    throw new Error('Site-scoped API Client list is invalid.');
  }
  assertNoRawKey(listed.data, credential.apiKey, 'API Client list');

  await request(`/delivery/v1/sites/${mainBlog.key}`, {
    expectedStatus: 401,
  });
  await request(`/delivery/v1/sites/${mainBlog.key}`, {
    expectedStatus: 403,
    authorization: `Bearer ${credential.apiKey}`,
  });
  await request(`/delivery/v1/sites/${mainBlog.key}`, {
    expectedStatus: 403,
    authorization: `Bearer ${credential.apiKey}`,
    origin: 'https://other.atlas.test',
  });

  const delivered = await request(`/delivery/v1/sites/${mainBlog.key}`, {
    expectedStatus: 200,
    authorization: `Bearer ${credential.apiKey}`,
    origin,
  });
  assertEqual(delivered.data.key, mainBlog.key, 'Delivered Site key');
  assertEqual(delivered.data.name, mainBlog.name, 'Delivered Site name');

  await request(`/delivery/v1/sites/${activeDevLog.key}`, {
    expectedStatus: 403,
    authorization: `Bearer ${credential.apiKey}`,
    origin,
  });

  const updated = await request(`/admin/v1/api-clients/${client.id}`, {
    method: 'PATCH',
    body: {
      version: client.version,
      name: 'Main Blog Delivery API',
      description: 'Updated by Atlas CI',
      rateLimitPerMinute: 120,
      requireOrigin: true,
      siteIds: [mainBlog.id],
      scopes: ['site:read', 'content:read'],
      allowedOrigins: [origin],
    },
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  client = updated.data;
  assertEqual(client.version, 2, 'Updated API Client version');
  assertEqual(client.rateLimitPerMinute, 120, 'Updated API Client rate limit');

  const rotated = await request(`/admin/v1/api-clients/${client.id}/keys/rotate`, {
    method: 'POST',
    body: { gracePeriodSeconds: 120 },
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  client = rotated.data.client;
  const rotatedCredential = rotated.data.credential;
  assertCredential(rotatedCredential);
  assertEqual(
    typeof rotatedCredential.previousKeyGraceExpiresAt,
    'string',
    'Previous Key grace expiry',
  );
  assertNoRawKey(client, rotatedCredential.apiKey, 'rotation response client');

  await request(`/delivery/v1/sites/${mainBlog.key}`, {
    expectedStatus: 200,
    authorization: `Bearer ${credential.apiKey}`,
    origin,
  });
  await request(`/delivery/v1/sites/${mainBlog.key}`, {
    expectedStatus: 200,
    authorization: `Bearer ${rotatedCredential.apiKey}`,
    origin,
  });

  const oldKey = client.keys.find((key) => key.id === credential.keyId);
  const newKey = client.keys.find((key) => key.id === rotatedCredential.keyId);

  if (!oldKey || oldKey.status !== 'grace' || !newKey || newKey.status !== 'active') {
    throw new Error('Rotated API Key statuses are invalid.');
  }

  const afterOldRevoke = await request(
    `/admin/v1/api-clients/${client.id}/keys/${credential.keyId}/revoke`,
    {
      method: 'POST',
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    },
  );
  client = afterOldRevoke.data;
  await request(`/delivery/v1/sites/${mainBlog.key}`, {
    expectedStatus: 401,
    authorization: `Bearer ${credential.apiKey}`,
    origin,
  });

  const afterNewRevoke = await request(
    `/admin/v1/api-clients/${client.id}/keys/${rotatedCredential.keyId}/revoke`,
    {
      method: 'POST',
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    },
  );
  client = afterNewRevoke.data;
  await request(`/delivery/v1/sites/${mainBlog.key}`, {
    expectedStatus: 401,
    authorization: `Bearer ${rotatedCredential.apiKey}`,
    origin,
  });

  const replacement = await request(`/admin/v1/api-clients/${client.id}/keys/rotate`, {
    method: 'POST',
    body: { gracePeriodSeconds: 0 },
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  client = replacement.data.client;
  credential = replacement.data.credential;
  assertCredential(credential);

  const disabled = await request(`/admin/v1/api-clients/${client.id}/disable`, {
    method: 'POST',
    body: { version: client.version },
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  client = disabled.data;
  assertEqual(client.status, 'disabled', 'Disabled API Client status');
  await request(`/delivery/v1/sites/${mainBlog.key}`, {
    expectedStatus: 401,
    authorization: `Bearer ${credential.apiKey}`,
    origin,
  });

  const enabled = await request(`/admin/v1/api-clients/${client.id}/enable`, {
    method: 'POST',
    body: { version: client.version },
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  client = enabled.data;
  await request(`/delivery/v1/sites/${mainBlog.key}`, {
    expectedStatus: 200,
    authorization: `Bearer ${credential.apiKey}`,
    origin,
  });

  const detail = await request(`/admin/v1/api-clients/${client.id}`, {
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
  });
  const usedKey = detail.data.keys.find((key) => key.id === credential.keyId);

  if (!usedKey || typeof usedKey.lastUsedAt !== 'string') {
    throw new Error('API Key last-used timestamp was not recorded.');
  }
  assertNoRawKey(detail.data, credential.apiKey, 'API Client detail');

  const archived = await request(`/admin/v1/api-clients/${client.id}/archive`, {
    method: 'POST',
    body: { version: client.version },
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  client = archived.data;
  assertEqual(client.status, 'archived', 'Archived API Client status');
  await request(`/delivery/v1/sites/${mainBlog.key}`, {
    expectedStatus: 401,
    authorization: `Bearer ${credential.apiKey}`,
    origin,
  });
  await request(`/admin/v1/api-clients/${client.id}/enable`, {
    method: 'POST',
    body: { version: client.version },
    expectedStatus: 409,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });

  const integration = await request('/admin/v1/api-clients', {
    method: 'POST',
    body: {
      name: 'CI Integration',
      type: 'integration',
      rateLimitPerMinute: 100,
      requireOrigin: false,
      siteIds: [mainBlog.id],
      scopes: ['health:write'],
      allowedOrigins: [],
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  await request(`/delivery/v1/sites/${mainBlog.key}`, {
    expectedStatus: 403,
    authorization: `Bearer ${integration.data.credential.apiKey}`,
  });

  const limited = await request('/admin/v1/api-clients', {
    method: 'POST',
    body: {
      name: 'Rate Limited Delivery',
      type: 'delivery',
      rateLimitPerMinute: 2,
      requireOrigin: false,
      siteIds: [mainBlog.id],
      scopes: ['site:read'],
      allowedOrigins: [],
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  const limitedKey = limited.data.credential.apiKey;

  await request(`/delivery/v1/sites/${mainBlog.key}`, {
    expectedStatus: 200,
    authorization: `Bearer ${limitedKey}`,
  });
  await request(`/delivery/v1/sites/${mainBlog.key}`, {
    expectedStatus: 200,
    authorization: `Bearer ${limitedKey}`,
  });
  const limitedResponse = await request(`/delivery/v1/sites/${mainBlog.key}`, {
    expectedStatus: 429,
    authorization: `Bearer ${limitedKey}`,
  });

  if (!limitedResponse.response.headers.get('retry-after')) {
    throw new Error('Rate-limited API response is missing Retry-After.');
  }
}

function assertApiClient(client, type, status) {
  if (
    !client ||
    typeof client.id !== 'string' ||
    client.type !== type ||
    client.status !== status ||
    !Array.isArray(client.siteIds) ||
    !Array.isArray(client.scopes) ||
    !Array.isArray(client.keys)
  ) {
    throw new Error(`API Client response is invalid for ${type}/${status}.`);
  }
}

function assertCredential(credential) {
  if (
    !credential ||
    typeof credential.keyId !== 'string' ||
    typeof credential.keyPrefix !== 'string' ||
    typeof credential.apiKey !== 'string' ||
    !credential.apiKey.startsWith(`${credential.keyPrefix}.`)
  ) {
    throw new Error('API Client credential response is invalid.');
  }
}

function assertNoRawKey(value, apiKey, label) {
  if (JSON.stringify(value).includes(apiKey)) {
    throw new Error(`${label} unexpectedly contains the raw API Key.`);
  }
}
