import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AtlasApiClient, AtlasApiError, problemToFormErrors } from './lib/api';

test('AtlasApiClient serializes JSON, includes credentials and attaches CSRF tokens', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedInit = init;

    return new Response(JSON.stringify({ data: { id: 'site-1' } }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const client = new AtlasApiClient({
    baseUrl: 'https://atlas.example/api/admin/v1/',
    fetcher,
    getCsrfToken: () => 'fallback-csrf-token',
  });

  const response = await client.post<{ data: { id: string } }>(
    '/sites',
    {
      name: 'Main Blog',
    },
    {
      csrfToken: 'explicit-csrf-token',
      responseType: 'json',
    },
  );
  const headers = new Headers(capturedInit?.headers);

  assert.equal(capturedUrl, 'https://atlas.example/api/admin/v1/sites');
  assert.equal(capturedInit?.method, 'POST');
  assert.equal(capturedInit?.credentials, 'include');
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(headers.get('x-csrf-token'), 'explicit-csrf-token');
  assert.equal(capturedInit?.body, JSON.stringify({ name: 'Main Blog' }));
  assert.equal(Object.hasOwn(capturedInit ?? {}, 'csrfToken'), false);
  assert.equal(Object.hasOwn(capturedInit ?? {}, 'responseType'), false);
  assert.equal(response.data.id, 'site-1');
});

test('AtlasApiClient converts Problem Details into AtlasApiError and form errors', async () => {
  const fetcher = (async () =>
    new Response(
      JSON.stringify({
        type: 'about:blank',
        title: 'Validation failed',
        status: 422,
        code: 'VALIDATION_FAILED',
        detail: '입력 값을 확인하세요.',
        requestId: 'request-1',
        details: {
          fields: {
            slug: ['이미 사용 중인 Slug입니다.', '이미 사용 중인 Slug입니다.'],
          },
        },
      }),
      {
        status: 422,
        headers: { 'content-type': 'application/problem+json' },
      },
    )) as typeof fetch;
  const client = new AtlasApiClient({
    baseUrl: '/api/admin/v1',
    fetcher,
  });

  await assert.rejects(client.get('/sites/main-blog'), (error: unknown) => {
    assert.equal(error instanceof AtlasApiError, true);
    const apiError = error as AtlasApiError;
    const formErrors = problemToFormErrors(apiError.problem);

    assert.equal(apiError.status, 422);
    assert.equal(apiError.code, 'VALIDATION_FAILED');
    assert.equal(apiError.requestId, 'request-1');
    assert.deepEqual(formErrors.fields.slug, ['이미 사용 중인 Slug입니다.']);
    assert.deepEqual(formErrors.form, []);
    return true;
  });
});

test('AtlasApiClient blocks absolute URLs and path traversal before network execution', async () => {
  let networkExecutions = 0;
  const client = new AtlasApiClient({
    baseUrl: '/api/admin/v1',
    fetcher: (async () => {
      networkExecutions += 1;
      return new Response(null, { status: 204 });
    }) as typeof fetch,
  });

  await assert.rejects(client.get('https://malicious.example/data'), TypeError);
  await assert.rejects(client.get('../delivery/v1/posts'), TypeError);
  await assert.rejects(client.get('%2e%2e/delivery/v1/posts'), TypeError);
  assert.equal(networkExecutions, 0);
});

test('AtlasApiClient uses a stable network error without exposing transport details', async () => {
  const client = new AtlasApiClient({
    baseUrl: '/api/admin/v1',
    fetcher: (async () => {
      throw new Error('connect ECONNREFUSED token=secret');
    }) as typeof fetch,
  });

  await assert.rejects(client.get('/sites'), (error: unknown) => {
    assert.equal(error instanceof AtlasApiError, true);
    const apiError = error as AtlasApiError;
    assert.equal(apiError.code, 'NETWORK_ERROR');
    assert.equal(apiError.problem.detail.includes('ECONNREFUSED'), false);
    assert.equal(apiError.problem.detail.includes('secret'), false);
    return true;
  });
});
