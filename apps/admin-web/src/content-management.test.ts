import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildContentListPath } from './features/content/content-api';

test('Content list path encodes cursor and filters', () => {
  assert.equal(
    buildContentListPath({
      cursor: 'cursor+value/with=symbols',
      limit: 25,
      search: ' atlas content ',
      status: 'ready',
      type: 'post',
    }),
    '/contents?limit=25&cursor=cursor%2Bvalue%2Fwith%3Dsymbols&search=atlas+content&status=ready&type=post',
  );
});
