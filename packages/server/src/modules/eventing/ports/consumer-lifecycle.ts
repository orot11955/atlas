import type { EventConsumptionRecord } from '../domain/eventing';
import type { EventConsumptionOwner } from './eventing-attempt-owner';

export const CONSUMER_KEY = 'atlas.eventing.v1';
export const CONSUMER_ATTEMPTS_PER_CYCLE = 5;
export const CONSUMER_RETRY_DELAYS_MS = Object.freeze([5_000, 30_000, 120_000, 600_000]);
export const CONSUMER_NOTIFICATION_LEASE_MS = 30_000;
export type ConsumerState = 'pending' | 'processing' | 'failed' | 'dead' | 'succeeded';
export type ReplayReason = 'dependency-restored' | 'handler-upgraded' | 'operator-reviewed';
export interface ConsumptionNotification {
  eventId: string;
  notificationVersion: number;
  availableAt: Date;
}
export interface ConsumptionView {
  id: string;
  eventId: string;
  consumerKey: string;
  status: ConsumerState;
  attemptCount: number;
  attemptLimit: number;
  cycleStartAttempt: number;
  nextAttemptAt: Date | null;
  failureCode: string | null;
  updatedAt: Date;
}
export interface ConsumptionReplayInput {
  eventId: string;
  replayId: string;
  expectedAttempt: number;
  reason: ReplayReason;
}
export interface ConsumptionReplayResult {
  replayId: string;
  eventId: string;
  previousAttempt: number;
  attemptLimit: number;
  replayed: boolean;
}
export interface ConsumptionCompletion {
  processedAt: Date;
  result?: Readonly<Record<string, unknown>>;
  errorMessage?: string;
  permanentFailure?: boolean;
}
export interface ConsumerLifecyclePort<TTransaction> {
  claimEventConsumption(
    eventId: string,
    consumerKey: string,
    claimedAt: Date,
    staleBefore: Date,
    transaction: TTransaction,
  ): Promise<EventConsumptionRecord | undefined>;
  lockEventConsumption(
    owner: Readonly<EventConsumptionOwner>,
    transaction: TTransaction,
  ): Promise<boolean>;
  completeEventConsumption(
    owner: Readonly<EventConsumptionOwner>,
    status: 'succeeded' | 'failed',
    input: Readonly<ConsumptionCompletion>,
    transaction: TTransaction,
  ): Promise<boolean>;
  reserveConsumptionNotifications(
    now: Date,
    staleBefore: Date,
    limit: number,
    transaction: TTransaction,
  ): Promise<readonly ConsumptionNotification[]>;
  listConsumptions(
    workspaceId: string,
    status: ConsumerState | undefined,
    limit: number,
  ): Promise<readonly ConsumptionView[]>;
  consumptionHistory(
    workspaceId: string,
    eventId: string,
    limit: number,
  ): Promise<
    Readonly<{
      attempts: readonly Record<string, unknown>[];
      replays: readonly Record<string, unknown>[];
    }>
  >;
  replayConsumption(
    workspaceId: string,
    actorId: string,
    input: Readonly<ConsumptionReplayInput>,
    at: Date,
    transaction: TTransaction,
  ): Promise<ConsumptionReplayResult>;
}

export function retryDelay(attemptNumber: number, cycleStartAttempt: number): number {
  if (
    !Number.isSafeInteger(attemptNumber) ||
    !Number.isSafeInteger(cycleStartAttempt) ||
    cycleStartAttempt < 0 ||
    attemptNumber <= cycleStartAttempt
  ) {
    throw new Error('Invalid Consumer retry counters.');
  }
  return CONSUMER_RETRY_DELAYS_MS[
    Math.min(attemptNumber - cycleStartAttempt - 1, CONSUMER_RETRY_DELAYS_MS.length - 1)
  ]!;
}
