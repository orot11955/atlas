export const REDACTED_LOG_VALUE = '[REDACTED]';

const CIRCULAR_LOG_VALUE = '[CIRCULAR]';
const TRUNCATED_LOG_VALUE = '[TRUNCATED]';
const MAX_DEPTH = 6;
const MAX_ARRAY_LENGTH = 50;
const MAX_OBJECT_KEYS = 100;
const MAX_STRING_LENGTH = 4_096;
const SENSITIVE_KEY_FRAGMENTS = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'credential',
  'privatekey',
  'accesskey',
  'apikey',
  'setcookie',
] as const;

const BEARER_PATTERN = /\bBearer\s+[^\s,;]+/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(password|passwd|token|secret|api[_-]?key|access[_-]?key|authorization|cookie)\s*([=:])\s*([^\s,;]+)/gi;

export function redactLogBindings(
  bindings: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return sanitizeRecord(bindings, 0, new WeakSet<object>());
}

export function redactLogMessage(message: string): string {
  return message
    .replace(BEARER_PATTERN, `Bearer ${REDACTED_LOG_VALUE}`)
    .replace(
      SECRET_ASSIGNMENT_PATTERN,
      (_match, key: string, separator: string) => `${key}${separator}${REDACTED_LOG_VALUE}`,
    );
}

function sanitizeRecord(
  value: Readonly<Record<string, unknown>>,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  if (depth >= MAX_DEPTH) {
    return { value: TRUNCATED_LOG_VALUE };
  }

  if (seen.has(value)) {
    return { value: CIRCULAR_LOG_VALUE };
  }

  seen.add(value);

  const entries = Object.entries(value);
  const result: Record<string, unknown> = {};

  for (const [key, entryValue] of entries.slice(0, MAX_OBJECT_KEYS)) {
    result[key] = isSensitiveKey(key)
      ? REDACTED_LOG_VALUE
      : sanitizeValue(entryValue, depth + 1, seen);
  }

  if (entries.length > MAX_OBJECT_KEYS) {
    result.__truncatedKeys = entries.length - MAX_OBJECT_KEYS;
  }

  return result;
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const redacted = redactLogMessage(value);
    return redacted.length > MAX_STRING_LENGTH
      ? `${redacted.slice(0, MAX_STRING_LENGTH)}${TRUNCATED_LOG_VALUE}`
      : redacted;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '[INVALID_DATE]' : value.toISOString();
  }

  if (value instanceof URL) {
    return redactLogMessage(value.toString());
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactLogMessage(value.message),
      stack: value.stack ? redactLogMessage(value.stack) : undefined,
    };
  }

  if (Buffer.isBuffer(value)) {
    return `[BINARY:${value.length}]`;
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) {
      return TRUNCATED_LOG_VALUE;
    }

    if (seen.has(value)) {
      return CIRCULAR_LOG_VALUE;
    }

    seen.add(value);

    const result = value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((entry) => sanitizeValue(entry, depth + 1, seen));

    if (value.length > MAX_ARRAY_LENGTH) {
      result.push(`${TRUNCATED_LOG_VALUE}:${value.length - MAX_ARRAY_LENGTH}`);
    }

    return result;
  }

  if (typeof value === 'object') {
    return sanitizeRecord(value as Record<string, unknown>, depth, seen);
  }

  return `[UNSUPPORTED:${typeof value}]`;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}
