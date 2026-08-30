import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ErrorCode,
  ResourceType,
  SiteMembershipStatus,
  assertNoLikelySecret,
  normalizeEmail,
  normalizeExternalIdentity,
  normalizeResourceSourceUrl,
  normalizeResourceTags,
  normalizeSecretReference,
} from './index';

test('Resource input normalizes tags, source URLs and Secret Store references', () => {
  assert.deepEqual(normalizeResourceTags([' TypeScript ', 'typescript', 'NestJS']), [
    'nestjs',
    'typescript',
  ]);
  assert.equal(
    normalizeResourceSourceUrl('https://example.com/docs'),
    'https://example.com/docs',
  );
  assert.equal(
    normalizeSecretReference('secret://atlas/production/database'),
    'secret://atlas/production/database',
  );
  assert.equal(ResourceType.DOCUMENT, 'document');
});

test('Resource and Member text rejects likely credentials', () => {
  assert.throws(
    () => assertNoLikelySecret(['api_key=atlas_live_123456789012345678901234']),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === ErrorCode.RESOURCE_SECRET_DETECTED,
  );
  assert.doesNotThrow(() =>
    assertNoLikelySecret(['Use secret://atlas/production/api-key instead.']),
  );
});

test('Member identities and Site Membership states remain separate', () => {
  assert.deepEqual(normalizeEmail(' OROT@Example.COM '), {
    email: 'OROT@Example.COM',
    normalizedEmail: 'orot@example.com',
  });
  assert.deepEqual(normalizeExternalIdentity('GITHUB', 'user-123'), {
    provider: 'github',
    subject: 'user-123',
  });
  assert.equal(SiteMembershipStatus.SUSPENDED, 'suspended');
});
