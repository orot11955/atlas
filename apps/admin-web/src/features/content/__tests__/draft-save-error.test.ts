import assert from 'node:assert/strict';
import test from 'node:test';

import { AtlasApiError } from '../../../lib/api/problem-details';
import { isDraftValidationError } from '../draft-save-error';

function apiError(status: number, code: string): AtlasApiError {
  return new AtlasApiError({
    type: 'about:blank',
    title: 'failure',
    status,
    code,
    detail: 'failure',
  });
}

test('only the confirmed validation status and code combination allows correction', () => {
  assert.equal(isDraftValidationError(apiError(400, 'VALIDATION_FAILED')), true);
  assert.equal(isDraftValidationError(apiError(422, 'VALIDATION_FAILED')), true);
  for (const status of [0, 401, 403, 409, 429, 500, 502, 503]) {
    assert.equal(isDraftValidationError(apiError(status, 'VALIDATION_FAILED')), false);
  }
  assert.equal(isDraftValidationError(apiError(400, 'HTTP_400')), false);
  assert.equal(isDraftValidationError(apiError(422, 'HTTP_422')), false);
  assert.equal(isDraftValidationError({ status: 400, code: 'VALIDATION_FAILED' }), false);
  assert.equal(isDraftValidationError(undefined), false);
});
