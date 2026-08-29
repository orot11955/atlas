export const REDACTED_AUDIT_VALUE = '[REDACTED]';

const CIRCULAR_AUDIT_VALUE = '[CIRCULAR]';
const TRUNCATED_AUDIT_VALUE = '[TRUNCATED]';
const MAX_DEPTH = 6;
const MAX_ARRAY_LENGTH = 50;
const MAX_OBJECT_KEYS = 100;
const MAX_STRING_LENGTH = 2_048;
const SECRET_FIELD_PATTERN =
  /password|secret|token|authorization|cookie|credential|private.?key|access.?key|session/i;

export function redactAuditMetadata(
  metadata: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
  return Object.freeze(sanitizeRecord(metadata, 0, new WeakSet<object>()));
}

function sanitizeRecord(
  value: Record<string, unknown>,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  if (depth >= MAX_DEPTH) {
    return { value: TRUNCATED_AUDIT_VALUE };
  }

  if (seen.has(value)) {
    return { value: CIRCULAR_AUDIT_VALUE };
  }

  seen.add(value);

  const result: Record<string, unknown> = {};
  const entries = Object.entries(value);

  for (const [key, entryValue] of entries.slice(0, MAX_OBJECT_KEYS)) {
    result[key] = SECRET_FIELD_PATTERN.test(key)
      ? REDACTED_AUDIT_VALUE
      : sanitizeValue(entryValue, depth + 1, seen);
  }

  if (entries.length > MAX_OBJECT_KEYS) {
    result.__truncatedKeys = entries.length - MAX_OBJECT_KEYS;
  }

  return result;
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}${TRUNCATED_AUDIT_VALUE}`
      : value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '[INVALID_DATE]' : value.toISOString();
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) {
      return TRUNCATED_AUDIT_VALUE;
    }

    if (seen.has(value)) {
      return CIRCULAR_AUDIT_VALUE;
    }

    seen.add(value);

    const sanitized = value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((entry) => sanitizeValue(entry, depth + 1, seen));

    if (value.length > MAX_ARRAY_LENGTH) {
      sanitized.push(`${TRUNCATED_AUDIT_VALUE}:${value.length - MAX_ARRAY_LENGTH}`);
    }

    return Object.freeze(sanitized);
  }

  if (typeof value === 'object') {
    return Object.freeze(sanitizeRecord(value as Record<string, unknown>, depth, seen));
  }

  return `[UNSUPPORTED:${typeof value}]`;
}
