import type { MigrationInterface, QueryRunner } from 'typeorm';

// Intentionally self-contained: historical migrations must not import mutable domain policy.
const BODY_MARKERS = "'[response body omitted by policy]', '[response body omitted: too large]'";
const ERROR_MARKERS = [
  'deadline-exceeded',
  'target-rejected',
  'dns-failed',
  'transport-failed',
  'response-incomplete',
  'invalid-response',
  'endpoint-disabled',
  'http-non-success',
  'processing-failed',
].map((code) => `'Webhook diagnostic: ${code}.'`).join(', ');
const SAFE_ERRORS = `${ERROR_MARKERS}, 'Recovered stale processing attempt.'`;

export class EnforceWebhookDiagnosticPolicy1788696000000 implements MigrationInterface {
  public readonly name = 'EnforceWebhookDiagnosticPolicy1788696000000';

  public async up(q: QueryRunner): Promise<void> {
    // Zero raw-response retention. Preserve signed request bodies, status, identities,
    // attempt numbers, all timestamps and Audit/Event/Publication history.
    for (const [table, body, error] of [
      ['webhook_deliveries', 'last_response_excerpt', 'last_error'],
      ['webhook_delivery_attempts', 'response_body_excerpt', 'error_message'],
    ]) {
      await q.query(`UPDATE ${table} SET
        ${body} = CASE WHEN ${body} IS NULL OR ${body} IN (${BODY_MARKERS}) THEN ${body}
          ELSE '[response body omitted by policy]' END,
        ${error} = CASE WHEN ${error} IS NULL OR ${error} IN (${SAFE_ERRORS}) THEN ${error}
          ELSE 'Webhook diagnostic: processing-failed.' END
        WHERE (${body} IS NOT NULL AND ${body} NOT IN (${BODY_MARKERS}))
           OR (${error} IS NOT NULL AND ${error} NOT IN (${SAFE_ERRORS}))`);
      await q.query(`ALTER TABLE ${table}
        ADD CONSTRAINT chk_${table}_safe_response CHECK (${body} IS NULL OR ${body} IN (${BODY_MARKERS})),
        ADD CONSTRAINT chk_${table}_safe_error CHECK (${error} IS NULL OR ${error} IN (${SAFE_ERRORS}))`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    // Schema rollback cannot and must not reconstruct discarded external diagnostic text.
    for (const table of ['webhook_deliveries', 'webhook_delivery_attempts']) {
      await q.query(`ALTER TABLE ${table}
        DROP CONSTRAINT chk_${table}_safe_response,
        DROP CONSTRAINT chk_${table}_safe_error`);
    }
  }
}
