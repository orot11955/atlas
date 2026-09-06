import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  WEBHOOK_RESPONSE_OMITTED,
  WEBHOOK_RESPONSE_TOO_LARGE,
  WebhookTransportError,
  safeWebhookErrorMessage,
  safeWebhookResponseExcerpt,
} from './modules/eventing/domain/webhook-diagnostics';

const secret = 'response-secret-marker/password?token=private';

test('Webhook diagnostics never retain arbitrary remote response values', () => {
  for (const value of [secret, '', { body: secret }, Buffer.from(secret)]) {
    assert.equal(safeWebhookResponseExcerpt(value), WEBHOOK_RESPONSE_OMITTED);
  }
  assert.equal(safeWebhookResponseExcerpt(undefined), undefined);
  assert.equal(safeWebhookResponseExcerpt(null), undefined);
  assert.equal(safeWebhookResponseExcerpt(WEBHOOK_RESPONSE_TOO_LARGE), WEBHOOK_RESPONSE_TOO_LARGE);
});

test('Webhook error diagnostics are allow-listed rather than truncating secrets', () => {
  for (const value of [secret, new Error(secret), { message: secret }]) {
    assert.equal(safeWebhookErrorMessage(value), 'Webhook diagnostic: processing-failed.');
  }
  assert.equal(safeWebhookErrorMessage(undefined), undefined);
  assert.equal(
    safeWebhookErrorMessage('Recovered stale processing attempt.'),
    'Recovered stale processing attempt.',
  );
  const timeout = new WebhookTransportError('deadline-exceeded');
  timeout.message = secret;
  assert.equal(safeWebhookErrorMessage(timeout), 'Webhook diagnostic: deadline-exceeded.');
  assert.equal(
    safeWebhookErrorMessage(safeWebhookErrorMessage(timeout)),
    'Webhook diagnostic: deadline-exceeded.',
  );
});
