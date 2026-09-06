/** Keep the TypeORM PostgreSQL RETURNING tuple at the persistence boundary. */
export function unwrapTypeOrmMutationRows<T>(result: unknown): readonly T[] {
  let rows: unknown = result;
  if (Array.isArray(result)) {
    if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
      if (!Number.isSafeInteger(result[1]) || result[1] < 0 || result[1] !== result[0].length) {
        throw new Error('TypeORM mutation affected count disagrees with returned rows.');
      }
      rows = result[0];
    }
  } else if (typeof result === 'object' && result !== null) {
    const record = result as Record<string, unknown>;
    rows = ['records', 'rows', 'raw'].map((key) => record[key]).find(Array.isArray);
  }
  if (
    !Array.isArray(rows) ||
    rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))
  ) {
    throw new Error('TypeORM mutation query returned an unsupported result shape.');
  }
  return rows as readonly T[];
}
