import { Column, Entity, PrimaryColumn } from 'typeorm';

import type { ApiClientScope } from '../../domain/api-client';

@Entity({ name: 'api_client_scopes' })
export class ApiClientScopeEntity {
  @PrimaryColumn({ name: 'api_client_id', type: 'uuid' })
  public apiClientId!: string;

  @PrimaryColumn({ type: 'varchar', length: 64 })
  public scope!: ApiClientScope;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}
