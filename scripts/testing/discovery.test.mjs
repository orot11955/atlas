import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertMinimum, discoverTests, runTestFiles } from './run-tests.mjs';

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'atlas-test-discovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

test('discovers nested tests in stable order and excludes generated files', (t) => {
  const root = fixture(t, {
    'z.test.ts': '',
    'feature/nested/a.test.tsx': '',
    'feature/unit.test.mjs': '',
    'feature/not-a-test.ts': '',
    'node_modules/hidden.test.ts': '',
    'dist/generated.test.js': '',
    '.next/compiled.test.js': '',
  });
  assert.deepEqual(
    discoverTests(root).map((path) => relative(root, path).replaceAll('\\', '/')),
    ['feature/nested/a.test.tsx', 'feature/unit.test.mjs', 'z.test.ts'],
  );
});

test('missing source and an unexpected empty or reduced inventory fail closed', (t) => {
  const root = fixture(t, {});
  assert.throws(() => discoverTests(join(root, 'missing')));
  assert.throws(() => assertMinimum([], 1, 'required'));
  assert.throws(() => assertMinimum(['one'], 2, 'required'));
  assert.throws(() => assertMinimum([], -1, 'invalid'));
  assert.doesNotThrow(() => assertMinimum([], 0, 'explicitly-empty'));
});

test('an explicitly empty workspace cannot fall back to implicit node discovery', (t) => {
  const root = fixture(t, { 'hidden.test.js': 'throw new Error("must not run");' });
  assert.equal(runTestFiles([], root), 0);
});

test('the runner executes a nested file and propagates its failure', (t) => {
  const root = fixture(t, {
    'nested/failing.test.mjs':
      'import test from "node:test"; test("sentinel", () => { throw new Error("sentinel"); });',
  });
  const runner = fileURLToPath(new URL('./run-tests.mjs', import.meta.url));
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { discoverTests, runTestFiles } from ${JSON.stringify(new URL('./run-tests.mjs', import.meta.url).href)};
       process.exitCode = runTestFiles(discoverTests(process.argv[1]), process.argv[1]);`,
      root,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 1);
  assert.match(child.stdout, /sentinel/u);
  const invalid = spawnSync(process.execPath, [runner, '--unknown'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
});

test('nested test files are passed to Node exactly once', (t) => {
  const root = fixture(t, {
    'nested/exactly-once.test.mjs': 'import test from "node:test"; test("runs-once", () => {});',
  });
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { discoverTests, runTestFiles } from ${JSON.stringify(new URL('./run-tests.mjs', import.meta.url).href)};
       process.exitCode = runTestFiles(discoverTests(process.argv[1]), process.argv[1]);`,
      root,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 0);
  assert.equal((child.stdout.match(/ok 1 - runs-once/gu) ?? []).length, 1);
  assert.match(child.stdout, /# tests 1/u);
});
