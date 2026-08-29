import 'reflect-metadata';

import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';

import {
  ActorType,
  Argon2idPasswordHasher,
  AuditService,
  BootstrapOwnerService,
  TypeOrmAdminAccountRepository,
  TypeOrmAuditRepository,
  TypeOrmTransactionRunner,
  createUuidV7,
  isApplicationError,
  requestContext,
} from '@atlas/server';

import { atlasDataSource } from './data-source';

interface CliOptions {
  email?: string;
  displayName?: string;
  passwordStdin: boolean;
  json: boolean;
  help: boolean;
}

interface OwnerBootstrapInput {
  email: string;
  displayName: string;
  password: string;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }

  const input = await readOwnerBootstrapInput(options);
  const requestId = createUuidV7();

  await atlasDataSource.initialize();

  try {
    const transactionRunner = new TypeOrmTransactionRunner(atlasDataSource);
    const adminAccounts = new TypeOrmAdminAccountRepository(atlasDataSource);
    const auditService = new AuditService(new TypeOrmAuditRepository(atlasDataSource));
    const service = new BootstrapOwnerService(
      transactionRunner,
      adminAccounts,
      new Argon2idPasswordHasher(),
      auditService,
    );

    const result = await requestContext.run(
      {
        requestId,
        traceId: requestId,
        actorType: ActorType.SYSTEM,
        actorId: 'system:owner-bootstrap',
      },
      () => service.execute(input),
    );

    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({
          id: result.id,
          email: result.email,
          displayName: result.displayName,
          role: result.role,
          createdAt: result.createdAt.toISOString(),
        })}\n`,
      );
      return;
    }

    process.stdout.write(`OWNER account created.\n`);
    process.stdout.write(`  id: ${result.id}\n`);
    process.stdout.write(`  email: ${result.email}\n`);
    process.stdout.write(`  display name: ${result.displayName}\n`);
  } finally {
    await atlasDataSource.destroy();
  }
}

function parseArguments(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    passwordStdin: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    switch (argument) {
      case '--email':
        options.email = requireArgumentValue(args, (index += 1), '--email');
        break;
      case '--display-name':
        options.displayName = requireArgumentValue(args, (index += 1), '--display-name');
        break;
      case '--password-stdin':
        options.passwordStdin = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${argument ?? ''}`);
    }
  }

  return options;
}

function requireArgumentValue(args: readonly string[], index: number, option: string): string {
  const value = args[index];

  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value.`);
  }

  return value;
}

async function readOwnerBootstrapInput(options: CliOptions): Promise<OwnerBootstrapInput> {
  const email = options.email ?? (await promptLine('OWNER email: '));
  const displayName =
    (options.displayName ?? (await promptLine('Display name [Owner]: '))) || 'Owner';
  const [password, passwordConfirmation] = options.passwordStdin
    ? await readPasswordPairFromStdin()
    : await promptPasswordPair();

  if (password !== passwordConfirmation) {
    throw new Error('Password confirmation does not match.');
  }

  return { email, displayName, password };
}

async function promptLine(prompt: string): Promise<string> {
  ensureInteractiveTerminal();
  const readline = createInterface({ input: process.stdin, output: process.stdout });

  try {
    return await readline.question(prompt);
  } finally {
    readline.close();
  }
}

async function promptPasswordPair(): Promise<readonly [string, string]> {
  ensureInteractiveTerminal();
  const password = await promptHidden('Password: ');
  const confirmation = await promptHidden('Confirm password: ');
  return [password, confirmation];
}

async function promptHidden(prompt: string): Promise<string> {
  const mutedOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const readline = createInterface({
    input: process.stdin,
    output: mutedOutput,
    terminal: true,
  });

  process.stdout.write(prompt);

  try {
    return await readline.question('');
  } finally {
    readline.close();
    process.stdout.write('\n');
  }
}

async function readPasswordPairFromStdin(): Promise<readonly [string, string]> {
  let input = '';

  for await (const chunk of process.stdin) {
    input += String(chunk);
  }

  const lines = input.replace(/\r\n/gu, '\n').split('\n');
  const password = lines[0] ?? '';
  const confirmation = lines[1] ?? '';

  if (password.length === 0 || confirmation.length === 0) {
    throw new Error('--password-stdin expects the password and confirmation on separate lines.');
  }

  return [password, confirmation];
}

function ensureInteractiveTerminal(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'Interactive input requires a TTY. Provide --email and --password-stdin for non-interactive use.',
    );
  }
}

function printUsage(): void {
  process.stdout.write(`Usage: pnpm admin:bootstrap-owner [options]\n\n`);
  process.stdout.write(`Options:\n`);
  process.stdout.write(`  --email <email>              OWNER email; prompted when omitted\n`);
  process.stdout.write(`  --display-name <name>        Display name; defaults to Owner\n`);
  process.stdout.write(
    `  --password-stdin             Read password and confirmation from stdin\n`,
  );
  process.stdout.write(`  --json                       Print the created account as JSON\n`);
  process.stdout.write(`  -h, --help                   Show this help\n`);
}

main().catch((error: unknown) => {
  if (isApplicationError(error)) {
    console.error(`[${error.code}] ${error.message}`);
  } else if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error('OWNER bootstrap failed.');
  }

  if (process.env.LOG_LEVEL === 'debug') {
    console.error(error);
  }

  process.exitCode = 1;
});
