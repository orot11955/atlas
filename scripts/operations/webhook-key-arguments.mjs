import { parseArgs } from 'node:util';

const versionPattern = /^[A-Za-z0-9._-]{1,64}$/u;
const workspacePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function parseWebhookKeyArguments(args) {
  const { values, positionals, tokens } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    tokens: true,
    options: {
      workspace: { type: 'string' },
      'expected-active-version': { type: 'string' },
      version: { type: 'string' },
      limit: { type: 'string' },
      apply: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  const names = tokens.filter((token) => token.kind === 'option').map((token) => token.name);
  if (new Set(names).size !== names.length) throw new Error('Duplicate maintenance option.');
  if (values.help) {
    if (names.length !== 1 || positionals.length) throw new Error('Invalid help invocation.');
    return { command: 'help' };
  }
  const command = positionals[0] ?? 'inspect';
  const allowed = {
    inspect: ['workspace'],
    reencrypt: ['workspace', 'expected-active-version', 'limit', 'apply'],
    'retire-check': ['version'],
  };
  if (
    positionals.length > 1 ||
    !Object.hasOwn(allowed, command) ||
    names.some((name) => !allowed[command].includes(name))
  ) {
    throw new Error('Invalid maintenance command or options.');
  }
  if (values.workspace !== undefined && !workspacePattern.test(values.workspace)) {
    throw new Error('Maintenance Workspace must be a canonical UUIDv7.');
  }
  if (command === 'inspect') return { command, workspaceId: values.workspace };
  if (command === 'retire-check') {
    if (!values.version || !versionPattern.test(values.version))
      throw new Error('Version required.');
    return { command, version: values.version };
  }
  if (
    !values.apply ||
    !values.workspace ||
    !values['expected-active-version'] ||
    !versionPattern.test(values['expected-active-version'])
  ) {
    throw new Error('Re-encryption requires Workspace, expected active version and --apply.');
  }
  const limit = values.limit === undefined ? 25 : Number(values.limit);
  if (
    (values.limit !== undefined && !/^(?:[1-9]|[1-4][0-9]|50)$/u.test(values.limit)) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    throw new Error('Batch size must be 1..50.');
  }
  return {
    command,
    workspaceId: values.workspace,
    expectedActiveVersion: values['expected-active-version'],
    limit,
  };
}
