import { atlasDataSource } from './data-source';

type MigrationCommand = 'run' | 'revert' | 'show';

async function main(): Promise<void> {
  const command = process.argv[2] as MigrationCommand | undefined;

  if (!command || !['run', 'revert', 'show'].includes(command)) {
    throw new Error('Usage: migration-cli.ts <run|revert|show>');
  }

  await atlasDataSource.initialize();

  try {
    if (command === 'run') {
      const executed = await atlasDataSource.runMigrations({
        transaction: 'all',
      });
      console.log(`Executed ${executed.length} migration(s).`);
      return;
    }

    if (command === 'revert') {
      await atlasDataSource.undoLastMigration({
        transaction: 'all',
      });
      console.log('Reverted the last migration.');
      return;
    }

    const pending = await atlasDataSource.showMigrations();
    console.log(pending ? 'Pending migrations exist.' : 'No pending migrations.');
  } finally {
    await atlasDataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
