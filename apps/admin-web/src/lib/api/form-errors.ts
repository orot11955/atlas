import type { ProblemDetails } from './problem-details';

export interface FormErrors {
  form: readonly string[];
  fields: Readonly<Record<string, readonly string[]>>;
}

export function problemToFormErrors(problem: ProblemDetails): FormErrors {
  const fields = readFieldErrors(problem.details?.fields);
  const hasFieldErrors = Object.keys(fields).length > 0;
  const form = uniqueStrings(
    problem.errors && problem.errors.length > 0
      ? problem.errors
      : hasFieldErrors
        ? []
        : [problem.detail],
  );

  return {
    form: Object.freeze(form),
    fields: Object.freeze(fields),
  };
}

function readFieldErrors(value: unknown): Record<string, readonly string[]> {
  if (!isRecord(value)) {
    return {};
  }

  const result: Record<string, readonly string[]> = {};

  for (const [field, messages] of Object.entries(value)) {
    const normalized = Array.isArray(messages)
      ? messages.filter((message): message is string => typeof message === 'string')
      : typeof messages === 'string'
        ? [messages]
        : [];
    const unique = uniqueStrings(normalized);

    if (unique.length > 0) {
      result[field] = Object.freeze(unique);
    }
  }

  return result;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
