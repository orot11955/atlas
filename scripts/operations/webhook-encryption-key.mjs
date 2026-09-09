import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseWebhookKeyArguments } from './webhook-key-arguments.mjs';

export async function runWebhookKeyMaintenance(args, environment = process.env) {
  const input = parseWebhookKeyArguments(args);
  if (input.command === 'help') {
    console.log('inspect [--workspace UUIDv7]');
    console.log('reencrypt --workspace UUIDv7 --expected-active-version VERSION --limit 25 --apply');
    console.log('retire-check --version VERSION');
    return;
  }
  // Explicit environment only. No network, queues, migrations or application boot on import.
  if (
    !environment.DATABASE_URL ||
    !environment.WEBHOOK_SECRET_ENCRYPTION_KEY_BASE64 ||
    !environment.WEBHOOK_SECRET_ENCRYPTION_KEY_VERSION
  ) {
    throw new Error('Database URL and active Webhook encryption configuration are required.');
  }
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const require = createRequire(resolve(root, 'packages/database/package.json'));
  require('reflect-metadata');
  const { DataSource } = require('typeorm');
  const {
    Aes256GcmWebhookSecretCipher,
    TypeOrmWebhookKeyMaintenanceRepository,
    WebhookKeyMaintenanceService,
    TypeOrmTransactionRunner,
    TypeOrmAuditRepository,
    AuditService,
    AuditLogEntity,
    ActorType,
    requestContext,
    createUuidV7,
  } = require('@atlas/server');
  const cipher = new Aes256GcmWebhookSecretCipher(
    environment.WEBHOOK_SECRET_ENCRYPTION_KEY_BASE64,
    environment.WEBHOOK_SECRET_ENCRYPTION_KEY_VERSION,
    environment.WEBHOOK_SECRET_DECRYPT_KEYS_JSON ?? '[]',
  );
  const database = new DataSource({
    type: 'postgres',
    url: environment.DATABASE_URL,
    entities: [AuditLogEntity],
    synchronize: false,
    migrationsRun: false,
    logging: false,
    extra: {
      max: 2,
      connectionTimeoutMillis: 5_000,
      options: '-c lock_timeout=5000 -c statement_timeout=30000',
    },
  });
  await database.initialize();
  try {
    const service = new WebhookKeyMaintenanceService(
      new TypeOrmTransactionRunner(database),
      new TypeOrmWebhookKeyMaintenanceRepository(database),
      cipher,
      new AuditService(new TypeOrmAuditRepository(database)),
    );
    if (input.command === 'inspect') {
      console.log(JSON.stringify(await service.inspect(input.workspaceId)));
    } else if (input.command === 'retire-check') {
      await service.assertRetirable(input.version);
      console.log(
        JSON.stringify({
          storedReferences: 0,
          version: input.version,
          keyDeleted: false,
          fleetAndBackupChecksStillRequired: true,
        }),
      );
    } else {
      const id = createUuidV7();
      const result = await requestContext.run(
        {
          requestId: id,
          traceId: id,
          actorType: ActorType.SYSTEM,
          actorId: 'cli:webhook-encryption',
          workspaceId: input.workspaceId,
        },
        () => service.reencryptBatch(input.workspaceId, input.expectedActiveVersion, input.limit),
      );
      // A skipped locked row can make changed=0; inspect remaining counts separately.
      console.log(JSON.stringify(result));
    }
  } finally {
    await database.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runWebhookKeyMaintenance(process.argv.slice(2)).catch(() => {
    // Never echo environment, connection URL, SQL parameters, keys or raw DB errors.
    console.error('Webhook key maintenance failed. Check arguments, key coverage and database access.');
    process.exitCode = 1;
  });
}
