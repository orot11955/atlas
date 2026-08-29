export function assertNever(value: never, message = 'Unhandled value'): never {
  throw new Error(`${message}: ${String(value)}`);
}

export function normalizeSlug(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
