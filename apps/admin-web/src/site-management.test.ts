import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSiteListPath } from './features/sites/site-api';
import { getSiteStatusTransitions } from './features/sites/site-types';

test('Site list path encodes cursor and filters without allowing raw query injection', () => {
  const path = buildSiteListPath({
    cursor: 'cursor+value/with=symbols',
    limit: 25,
    search: ' main blog ',
    status: 'active',
    type: 'blog',
  });

  assert.equal(
    path,
    '/sites?cursor=cursor%2Bvalue%2Fwith%3Dsymbols&limit=25&search=main+blog&status=active&type=blog',
  );
});

test('Site status transitions match the server lifecycle boundary', () => {
  assert.deepEqual(getSiteStatusTransitions('draft'), ['active', 'disabled', 'archived']);
  assert.deepEqual(getSiteStatusTransitions('active'), ['maintenance', 'disabled']);
  assert.deepEqual(getSiteStatusTransitions('maintenance'), ['active', 'disabled']);
  assert.deepEqual(getSiteStatusTransitions('disabled'), ['active', 'archived']);
  assert.deepEqual(getSiteStatusTransitions('archived'), []);
});
