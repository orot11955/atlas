import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWebhookKeyArguments as parse } from './webhook-key-arguments.mjs';
import { runWebhookKeyMaintenance } from './webhook-encryption-key.mjs';
const workspace = '01a076d4-4d2e-7fe9-8fa3-d797183ba87f';

test('default invocation is read-only inventory', () => {
  assert.deepEqual(parse([]), { command: 'inspect', workspaceId: undefined });
});
test('explicit scoped single-batch mutation parses without accepting key material as arguments', () => {
  assert.deepEqual(
    parse([
      'reencrypt',
      '--workspace',
      workspace,
      '--expected-active-version',
      'v2',
      '--limit',
      '1',
      '--apply',
    ]),
    { command: 'reencrypt', workspaceId: workspace, expectedActiveVersion: 'v2', limit: 1 },
  );
});
test('retire-check is global and never deletes a key', () => {
  assert.deepEqual(parse(['retire-check', '--version', 'v1']), {
    command: 'retire-check',
    version: 'v1',
  });
});
for (const args of [
  ['reencrypt'],
  ['reencrypt', '--workspace', workspace, '--expected-active-version', 'v2'],
  ['reencrypt', '--apply'],
  ['inspect', '--apply'],
  ['retire-check', '--version', 'v1', '--workspace', workspace],
  ['inspect', '--workspace', 'bad'],
  ['inspect', '--workspace', workspace, '--workspace', workspace],
  [
    'reencrypt',
    '--workspace',
    workspace,
    '--expected-active-version',
    'v2',
    '--apply',
    '--limit',
    '51',
  ],
  [
    'reencrypt',
    '--workspace',
    workspace,
    '--expected-active-version',
    'v2',
    '--apply',
    '--limit',
    '1e1',
  ],
  ['inspect', '--key', 'secret'],
  ['delete'],
  ['inspect', 'extra'],
]) {
  test(`unsafe or ambiguous CLI arguments rejected: ${args.join(' ')}`, () => {
    assert.throws(() => parse(args));
  });
}
test('missing environment fails before loading a database driver or opening a connection', async () => {
  await assert.rejects(runWebhookKeyMaintenance([], {}), /configuration/u);
});
