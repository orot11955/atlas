import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'api_client_allowed_origins' })
export class ApiClientAllowedOriginEntity {
  @PrimaryColumn({ name: 'api_client_id', type: 'uuid' })
  public apiClientId!: string;

  @PrimaryColumn({ type: 'varchar', length: 512 })
  public origin!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}
