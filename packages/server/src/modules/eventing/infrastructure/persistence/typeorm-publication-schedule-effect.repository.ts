import type { EntityManager } from 'typeorm';
import {
  readPublicationScheduleTarget,
  type PublicationScheduleEffectReceipt,
} from '../../domain/scheduled-publication';
import type { PublicationScheduleEffectRepositoryPort } from '../../ports/publication-schedule-effect.repository';
import { requireEventingTransaction } from './eventing-attempt.persistence';

export class TypeOrmPublicationScheduleEffectRepository
implements PublicationScheduleEffectRepositoryPort<EntityManager> {
  public async find(scheduleId: string, workspaceId: string, transaction: EntityManager):
    Promise<Readonly<PublicationScheduleEffectReceipt> | undefined> {
    requireEventingTransaction(transaction);
    const rows = await transaction.query<Record<string, unknown>[]>(
      'SELECT * FROM publication_schedule_effects WHERE schedule_id = $1 AND workspace_id = $2',
      [scheduleId, workspaceId],
    );
    const row = rows[0];
    if (!row) return undefined;
    const outcome = row.outcome;
    if (outcome !== 'published' && outcome !== 'already-published' &&
        outcome !== 'withdrawn' && outcome !== 'already-inactive') {
      throw new Error('Unknown Publication schedule effect outcome.');
    }
    return Object.freeze({
      scheduleId: String(row.schedule_id), workspaceId: String(row.workspace_id),
      contentId: String(row.content_id), contentSiteId: String(row.content_site_id), siteId: String(row.site_id),
      target: readPublicationScheduleTarget({
        action: row.action as 'publish' | 'withdraw',
        revisionId: row.revision_id == null ? undefined : String(row.revision_id),
        revisionNumber: row.revision_number == null ? undefined : Number(row.revision_number),
        targetPublicationId: row.target_publication_id == null ? undefined : String(row.target_publication_id),
      }),
      publicationId: String(row.publication_id), outcome,
      recordedAt: new Date(row.recorded_at as Date),
    });
  }

  public async insert(receipt: Readonly<PublicationScheduleEffectReceipt>, transaction: EntityManager): Promise<void> {
    requireEventingTransaction(transaction);
    const target = receipt.target;
    await transaction.query(
      `INSERT INTO publication_schedule_effects
       (schedule_id, workspace_id, content_id, content_site_id, site_id, action,
        revision_id, revision_number, target_publication_id, publication_id, outcome, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [receipt.scheduleId, receipt.workspaceId, receipt.contentId, receipt.contentSiteId, receipt.siteId,
        target.action, target.action === 'publish' ? target.revisionId : null,
        target.action === 'publish' ? target.revisionNumber : null,
        target.action === 'withdraw' ? target.targetPublicationId : null,
        receipt.publicationId, receipt.outcome, receipt.recordedAt],
    );
  }
}
