import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const testFilePattern = /\.test\.(?:[cm]?[jt]s|[jt]sx)$/u;
const ignoredDirectories = new Set(['node_modules', 'dist', '.next', '.git', 'coverage']);

export function discoverTests(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
      files.push(...discoverTests(path));
    } else if (entry.isFile() && testFilePattern.test(entry.name)) {
      files.push(path);
    }
  }
  return files.sort();
}

export function assertMinimum(files, minimum, workspace) {
  if (!Number.isSafeInteger(minimum) || minimum < 0) {
    throw new Error(`Invalid test inventory minimum for ${workspace}.`);
  }
  if (files.length < minimum) {
    throw new Error(`${workspace}: discovered ${files.length} test files; expected >= ${minimum}.`);
  }
}

function readInventory() {
  return JSON.parse(readFileSync(join(repositoryRoot, 'scripts/testing/inventory.json'), 'utf8'));
}

function inspectWorkspace(workspace, minimum) {
  const files = discoverTests(join(repositoryRoot, workspace, 'src'));
  assertMinimum(files, minimum, workspace);
  console.log(`[test-discovery] ${workspace}: ${files.length} files (minimum ${minimum})`);
  for (const file of files) console.log(`  ${relative(repositoryRoot, file)}`);
  return files;
}

export function runTestFiles(files, cwd) {
  if (files.length === 0) return 0;
  const needsTsx = files.some((file) => /\.(?:[cm]?ts|[jt]sx)$/u.test(file));
  const runtime = needsTsx ? [createRequire(join(cwd, 'package.json')).resolve('tsx/cli')] : [];
  // Explicit paths avoid shell glob differences and never fall back to implicit discovery.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [...runtime, '--test', ...files], {
    cwd,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !['--inventory', '--list'].includes(args[0]))) {
    throw new Error('Usage: run-tests.mjs [--inventory|--list]');
  }
  const inventory = readInventory();
  if (args[0] === '--inventory') {
    const workspaces = ['apps', 'packages'].flatMap((parent) =>
      readdirSync(join(repositoryRoot, parent), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${parent}/${entry.name}`),
    );
    for (const workspace of workspaces) {
      if (!(workspace in inventory)) throw new Error(`Untracked test workspace: ${workspace}`);
      const manifest = JSON.parse(
        readFileSync(join(repositoryRoot, workspace, 'package.json'), 'utf8'),
      );
      if (manifest.scripts.test !== 'node ../../scripts/testing/run-tests.mjs') {
        throw new Error(`${workspace}: test command must use the shared discovery runner.`);
      }
      inspectWorkspace(workspace, inventory[workspace]);
    }
    if (workspaces.length !== Object.keys(inventory).length) {
      throw new Error('Test inventory contains a removed workspace. Review the baseline.');
    }
    return 0;
  }
  const workspace = relative(repositoryRoot, process.cwd()).replaceAll('\\', '/');
  if (!(workspace in inventory)) throw new Error(`Untracked test workspace: ${workspace}`);
  const files = inspectWorkspace(workspace, inventory[workspace]);
  return args[0] === '--list' ? 0 : runTestFiles(files, process.cwd());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
