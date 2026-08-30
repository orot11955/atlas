import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildApiClientListPath,
  parseAllowedOrigins,
  toOptionalIsoDate,
} from './features/api-clients/api-client-api';
import {
  getApiClientScopes,
  getApiClientStatusTransitions,
} from './features/api-clients/api-client-types';

test('API Client list path encodes Site filters and search text', () => {
  assert.equal(
    buildApiClientListPath({
      siteId: '01990000-0000-7000-8000-000000000001',
      status: 'active',
      type: 'delivery',
      search: ' main blog ',
    }),
    '/api-clients?siteId=01990000-0000-7000-8000-000000000001&status=active&type=delivery&search=main+blog',
  );
});

test('Allowed Origin input is trimmed, deduplicated and empty lines are removed', () => {
  assert.deepEqual(
    parseAllowedOrigins(
      ' https://blog.example.com\n\nhttps://preview.example.com\nhttps://blog.example.com ',
    ),
    ['https://blog.example.com', 'https://preview.example.com'],
  );
});

test('Client types expose only their allowed scopes and terminal archive state', () => {
  assert.deepEqual(getApiClientScopes('delivery'), [
    'site:read',
    'content:read',
    'feed:read',
  ]);
  assert.deepEqual(getApiClientScopes('integration'), [
    'release:write',
    'deployment:create',
    'deployment:update',
    'health:write',
  ]);
  assert.deepEqual(getApiClientStatusTransitions('active'), [
    'disabled',
    'archived',
  ]);
  assert.deepEqual(getApiClientStatusTransitions('archived'), []);
  assert.equal(toOptionalIsoDate(''), undefined);
});
