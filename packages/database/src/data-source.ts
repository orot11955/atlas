import 'dotenv/config';
import 'reflect-metadata';

import path from 'node:path';

import { DataSource } from 'typeorm';

const packageRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const compiledRuntime = path.basename(__dirname) === 'dist';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to use the TypeORM DataSource.');
}

export const atlasDataSource = new DataSource({
  type: 'postgres',
  url: databaseUrl,
  synchronize: false,
  migrationsRun: false,
  logging: process.env.NODE_ENV === 'development',
  migrationsTableName: 'atlas_migrations',
  entities: [
    path.join(
      repositoryRoot,
      compiledRuntime ? 'packages/server/dist/**/*.entity.js' : 'packages/server/src/**/*.entity.ts',
    ),
  ],
  migrations: [
    path.join(
      packageRoot,
      compiledRuntime ? 'dist/migrations/*.js' : 'src/migrations/*.ts',
    ),
  ],
});

export default atlasDataSource;
