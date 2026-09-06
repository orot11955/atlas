import type { PublicationScheduleAttemptOwner } from './eventing.repository';

/** Scheduled execution must pin its target and durably deduplicate its business effect. */
export interface PublicationCommandPort {
  executeScheduled(owner: Readonly<PublicationScheduleAttemptOwner>):
    Promise<Readonly<{ replayed: boolean; stale: boolean }>>;
}
