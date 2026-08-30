import assert from 'node:assert/strict';
import test from 'node:test';

import { loadResources } from './features/resource-member/resource-member-api';
import { RESOURCE_TYPE_OPTIONS } from './features/resource-member/resource-member-types';

test('Resource type options keep the supported Domain set stable', () => {
  assert.deepEqual(
    RESOURCE_TYPE_OPTIONS.map((option) => option.value),
    ['note', 'document', 'link', 'reference', 'checklist', 'snippet'],
  );
});

test('Resource API helper is exported for authenticated administration use', () => {
  assert.equal(typeof loadResources, 'function');
});
