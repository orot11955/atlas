import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import {
  AuditLogEntity,
  AuditService,
  TypeOrmAuditRepository,
  TypeOrmTransactionRunner,
} from '@atlas/server';

import { AUDIT_SERVICE, TRANSACTION_RUNNER } from './platform.tokens';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLogEntity])],
  providers: [
    {
      provide: AUDIT_SERVICE,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) =>
        new AuditService(new TypeOrmAuditRepository(dataSource)),
    },
    {
      provide: TRANSACTION_RUNNER,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new TypeOrmTransactionRunner(dataSource),
    },
  ],
  exports: [AUDIT_SERVICE, TRANSACTION_RUNNER],
})
export class PlatformModule {}
