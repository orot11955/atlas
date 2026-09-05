import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type WorkerEnvironment } from '@atlas/config';
import {
  ATLAS_LOGGER,
  AtlasLogLevel,
  type AtlasLogger,
  type OutboxRelayService,
} from '@atlas/server';

import { WORKER_OUTBOX_RELAY_SERVICE } from './eventing.tokens';

@Injectable()
export class EventingRelayLoop implements OnModuleInit, OnApplicationShutdown {
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private readonly pollMilliseconds: number;

  public constructor(
    private readonly config: ConfigService<WorkerEnvironment, true>,
    @Inject(WORKER_OUTBOX_RELAY_SERVICE)
    private readonly relay: OutboxRelayService<unknown>,
    @Inject(ATLAS_LOGGER) private readonly logger: AtlasLogger,
  ) {
    this.pollMilliseconds = Math.min(
      config.get('OUTBOX_RELAY_POLL_MS', { infer: true }),
      config.get('WEBHOOK_DELIVERY_POLL_MS', { infer: true }),
      config.get('PUBLICATION_SCHEDULE_POLL_MS', { infer: true }),
    );
  }

  public onModuleInit(): void {
    this.schedule(0);
  }

  public async onApplicationShutdown(): Promise<void> {
    this.stopped = true;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    await this.running;
  }

  private schedule(delay: number): void {
    if (this.stopped) return;

    this.timer = setTimeout(() => {
      this.running = this.tick().finally(() => {
        this.running = undefined;
        this.schedule(this.pollMilliseconds);
      });
    }, delay);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    try {
      const outboxCount = await this.relay.relayAvailable();
      const recovered = await this.relay.recoverDueWork();

      if (outboxCount > 0 || recovered.schedules > 0 || recovered.deliveries > 0) {
        this.logger.write(
          AtlasLogLevel.DEBUG,
          {
            event: 'eventing.relay.completed',
            outboxCount,
            scheduleCount: recovered.schedules,
            deliveryCount: recovered.deliveries,
          },
          'Eventing relay processed available work.',
        );
      }
    } catch (error) {
      this.logger.write(
        AtlasLogLevel.ERROR,
        { event: 'eventing.relay.failed' },
        'Eventing relay iteration failed.',
        error instanceof Error ? error : new Error('Unknown Eventing relay failure.'),
      );
    }
  }
}
