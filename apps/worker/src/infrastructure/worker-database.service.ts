import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';

import { atlasDataSource } from '@atlas/database';

@Injectable()
export class WorkerDatabaseService implements OnModuleInit, OnApplicationShutdown {
  public readonly dataSource = atlasDataSource;
  private initialization?: Promise<void>;

  public onModuleInit(): Promise<void> {
    return this.ready();
  }

  public async ready(): Promise<void> {
    if (this.dataSource.isInitialized) {
      return;
    }

    this.initialization ??= this.dataSource.initialize().then(() => undefined);
    await this.initialization;
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }
}
