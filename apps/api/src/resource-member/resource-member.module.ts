import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import {
  MemberAdminNoteEntity,
  MemberEntity,
  ResourceAssetEntity,
  ResourceCollectionEntity,
  ResourceEntity,
  ResourceMemberService,
  ResourceRelationEntity,
  ResourceTagAssignmentEntity,
  ResourceTagEntity,
  SiteMembershipEntity,
  TypeOrmResourceMemberRepository,
  type AuditService,
  type ResourceMemberRepositoryPort,
  type TransactionRunner,
} from '@atlas/server';

import { AdminSessionModule } from '../admin-session/admin-session.module';
import { AdminWorkspaceSiteModule } from '../admin-sites/admin-workspace-site.module';
import { PlatformModule } from '../platform/platform.module';
import { AUDIT_SERVICE, TRANSACTION_RUNNER } from '../platform/platform.tokens';
import { ResourceMemberController } from './resource-member.controller';
import { RESOURCE_MEMBER_REPOSITORY, RESOURCE_MEMBER_SERVICE } from './resource-member.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ResourceCollectionEntity,
      ResourceTagEntity,
      ResourceEntity,
      ResourceTagAssignmentEntity,
      ResourceRelationEntity,
      ResourceAssetEntity,
      MemberEntity,
      SiteMembershipEntity,
      MemberAdminNoteEntity,
    ]),
    PlatformModule,
    AdminSessionModule,
    AdminWorkspaceSiteModule,
  ],
  controllers: [ResourceMemberController],
  providers: [
    {
      provide: RESOURCE_MEMBER_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new TypeOrmResourceMemberRepository(dataSource),
    },
    {
      provide: RESOURCE_MEMBER_SERVICE,
      inject: [TRANSACTION_RUNNER, RESOURCE_MEMBER_REPOSITORY, AUDIT_SERVICE],
      useFactory: (
        transactionRunner: TransactionRunner<EntityManager>,
        repository: ResourceMemberRepositoryPort<EntityManager>,
        auditService: AuditService<EntityManager>,
      ) => new ResourceMemberService(transactionRunner, repository, auditService),
    },
  ],
  exports: [RESOURCE_MEMBER_SERVICE],
})
export class ResourceMemberModule {}
