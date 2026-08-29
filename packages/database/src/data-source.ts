import 'dotenv/config';
import 'reflect-metadata';

import path from 'node:path';

import { DataSource } from 'typeorm';

const packageRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(packageRoot, '../..');

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
    path.join(repositoryRoot, 'packages/server/src/**/*.entity.ts'),
    path.join(repositoryRoot, 'packages/server/dist/**/*.entity.js'),
  ],
  migrations: [
    path.join(packageRoot, 'src/migrations/*.ts'),
    path.join(packageRoot, 'dist/migrations/*.js'),
  ],
});

export default atlasDataSource;
