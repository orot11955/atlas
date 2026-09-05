import { AtlasApiError } from '../../lib/api/problem-details';

/** Fail closed: a generic 4xx/5xx, malformed response or network error is not
 * proof that the server rejected a write before committing it. */
export function isDraftValidationError(error: unknown): boolean {
  return (
    error instanceof AtlasApiError &&
    (error.status === 400 || error.status === 422) &&
    error.code === 'VALIDATION_FAILED'
  );
}
