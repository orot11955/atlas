import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'workspaces' })
@Index('uq_workspaces_key', ['key'], { unique: true })
export class WorkspaceEntity {
  @PrimaryColumn({ type: 'uuid' })
  public id!: string;

  @Column({ type: 'varchar', length: 64 })
  public key!: string;

  @Column({ type: 'varchar', length: 120 })
  public name!: string;

  @Column({ type: 'varchar', length: 64 })
  public timezone!: string;

  @Column({ type: 'varchar', length: 32 })
  public locale!: string;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  public isDefault!: boolean;

  @Column({ type: 'integer', default: 1 })
  public version!: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
