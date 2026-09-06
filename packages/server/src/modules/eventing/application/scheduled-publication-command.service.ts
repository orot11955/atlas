import {
  ActorType, DomainError, ErrorCode, requestContext, systemClock,
  type Clock, type TransactionRunner,
} from '../../../core';
import type { ContentPublicationService } from '../../content/application/content-publication.service';
import type { ContentPublicationRepositoryPort } from '../../content/ports/content-publication.repository';
import {
  readPublicationScheduleTarget,
  type PublicationScheduleEffectReceipt,
  type ScheduledPublicationTarget,
} from '../domain/scheduled-publication';
import type { EventingRepositoryPort, PublicationScheduleAttemptOwner } from '../ports/eventing.repository';
import type { PublicationCommandPort } from '../ports/publication-command.port';
import type { PublicationScheduleEffectRepositoryPort } from '../ports/publication-schedule-effect.repository';

/** The factory MUST bind the existing Publication service's runner to the supplied transaction.
 * This is a unit-of-work boundary: Publication, its Audit/Outbox and the receipt commit together.
 */
export type ScheduledPublicationFactory<TTransaction> = (transaction: TTransaction) =>
  Pick<ContentPublicationService<TTransaction>, 'publishRevision' | 'withdraw'>;

export class ScheduledPublicationCommandService<TTransaction> implements PublicationCommandPort {
  public constructor(
    private readonly transactions: TransactionRunner<TTransaction>,
    private readonly schedules: EventingRepositoryPort<TTransaction>,
    private readonly effects: PublicationScheduleEffectRepositoryPort<TTransaction>,
    private readonly publications: ContentPublicationRepositoryPort<TTransaction>,
    private readonly publicationFactory: ScheduledPublicationFactory<TTransaction>,
    private readonly clock: Clock = systemClock,
  ) {}

  public async executeScheduled(owner: Readonly<PublicationScheduleAttemptOwner>):
    Promise<Readonly<{ replayed: boolean; stale: boolean }>> {
    if (!owner || typeof owner.scheduleId !== 'string' || !owner.scheduleId ||
        typeof owner.workspaceId !== 'string' || !owner.workspaceId ||
        !Number.isSafeInteger(owner.attemptNumber) || owner.attemptNumber < 1 ||
        !Number.isSafeInteger(owner.version) || owner.version < 1) {
      throw new Error('A complete scheduled Publication attempt owner is required.');
    }
    return this.transactions.run(async (transaction) => {
      const schedule = await this.schedules.findPublicationScheduleForUpdate(
        owner.workspaceId, owner.scheduleId, transaction,
      );
      if (!schedule || schedule.status !== 'processing' ||
          schedule.attemptCount !== owner.attemptNumber || schedule.version !== owner.version) {
        return Object.freeze({ stale: true, replayed: false });
      }
      const context = requestContext.require();
      if (context.actorType !== ActorType.ADMIN || context.actorId !== schedule.requestedByAdminAccountId ||
          context.workspaceId !== schedule.workspaceId || context.siteId !== schedule.siteId) {
        throw new DomainError({ code: ErrorCode.FORBIDDEN,
          message: 'Scheduled Publication execution requires its scoped requester context.' });
      }
      const target = readPublicationScheduleTarget(schedule);
      const previous = await this.effects.find(schedule.id, schedule.workspaceId, transaction);
      if (previous) {
        if (previous.contentId !== schedule.contentId || previous.contentSiteId !== schedule.contentSiteId ||
            previous.siteId !== schedule.siteId || !sameTarget(previous.target, target)) {
          throw new Error('Publication schedule effect receipt does not match its immutable definition.');
        }
        // Do not republish a historical receipt after a later manual publication/withdrawal.
        return Object.freeze({ stale: false, replayed: true });
      }
      // Keep the existing ContentSite -> Content lock order. The schedule lock prevents
      // stale recovery/cancellation from racing the business effect, not only bookkeeping.
      const contentSite = await this.publications.findContentSiteForUpdate(
        schedule.workspaceId, schedule.contentId, schedule.contentSiteId, transaction,
      );
      if (!contentSite || contentSite.siteId !== schedule.siteId) {
        throw new DomainError({ code: ErrorCode.NOT_FOUND, message: 'Scheduled Content Site was not found.' });
      }
      const command = this.publicationFactory(transaction);
      let publicationId: string;
      let outcome: PublicationScheduleEffectReceipt['outcome'];
      if (target.action === 'publish') {
        const result = await command.publishRevision(
          schedule.workspaceId, schedule.contentId, schedule.contentSiteId, target.revisionId,
        );
        if (result.publication.revisionId !== target.revisionId ||
            result.publication.revisionNumber !== target.revisionNumber) {
          throw new Error('Publication result did not match the pinned Revision.');
        }
        publicationId = result.publication.id;
        outcome = result.replayed ? 'already-published' : 'published';
      } else {
        const expected = await this.publications.findPublication(
          schedule.workspaceId, schedule.contentSiteId, target.targetPublicationId, transaction,
        );
        if (!expected || expected.contentId !== schedule.contentId || expected.siteId !== schedule.siteId) {
          throw new DomainError({ code: ErrorCode.NOT_FOUND, message: 'Scheduled Publication target was not found.' });
        }
        publicationId = expected.id;
        if (expected.status === 'withdrawn' || expected.status === 'superseded') {
          outcome = 'already-inactive';
        } else {
          const active = await this.publications.findActivePublication(
            schedule.workspaceId, schedule.contentSiteId, transaction,
          );
          if (expected.status !== 'active' || active?.id !== expected.id) {
            throw new DomainError({ code: ErrorCode.INVALID_STATE_TRANSITION,
              message: 'Scheduled Publication is not the expected active target.' });
          }
          const withdrawn = await command.withdraw(schedule.workspaceId, schedule.contentId, schedule.contentSiteId);
          if (withdrawn.id !== expected.id) throw new Error('Withdrawal changed a different Publication.');
          outcome = 'withdrawn';
        }
      }
      await this.effects.insert({
        scheduleId: schedule.id, workspaceId: schedule.workspaceId, siteId: schedule.siteId,
        contentId: schedule.contentId, contentSiteId: schedule.contentSiteId,
        target, publicationId, outcome, recordedAt: this.clock.now(),
      }, transaction);
      return Object.freeze({ stale: false, replayed: false });
    });
  }
}

function sameTarget(left: ScheduledPublicationTarget, right: ScheduledPublicationTarget): boolean {
  if (left.action === 'publish' && right.action === 'publish') {
    return left.revisionId === right.revisionId && left.revisionNumber === right.revisionNumber;
  }
  return left.action === 'withdraw' && right.action === 'withdraw' &&
    left.targetPublicationId === right.targetPublicationId;
}
