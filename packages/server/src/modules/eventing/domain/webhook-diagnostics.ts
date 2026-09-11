export const WEBHOOK_RESPONSE_OMITTED = '[response body omitted by policy]';
export const WEBHOOK_RESPONSE_TOO_LARGE = '[response body omitted: too large]';

const FAILURE_MESSAGES = Object.freeze({
  'deadline-exceeded': 'Webhook diagnostic: deadline-exceeded.',
  'target-rejected': 'Webhook diagnostic: target-rejected.',
  'dns-failed': 'Webhook diagnostic: dns-failed.',
  'transport-failed': 'Webhook diagnostic: transport-failed.',
  'response-incomplete': 'Webhook diagnostic: response-incomplete.',
  'invalid-response': 'Webhook diagnostic: invalid-response.',
  'endpoint-disabled': 'Webhook diagnostic: endpoint-disabled.',
  'http-non-success': 'Webhook diagnostic: http-non-success.',
  'processing-failed': 'Webhook diagnostic: processing-failed.',
});
export type WebhookFailureCode = keyof typeof FAILURE_MESSAGES;

/** No remote URL, body, header, resolver error or secret enters this error. */
export class WebhookTransportError extends Error {
  public constructor(public readonly code: WebhookFailureCode) {
    super(FAILURE_MESSAGES[code]);
    this.name = 'WebhookTransportError';
  }
}

/** Compatibility field: excerpts now contain only fixed omission markers. */
export function safeWebhookResponseExcerpt(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return value === WEBHOOK_RESPONSE_TOO_LARGE
    ? WEBHOOK_RESPONSE_TOO_LARGE
    : WEBHOOK_RESPONSE_OMITTED;
}

/** An arbitrary exception message must never be copied to persistent diagnostics. */
export function safeWebhookErrorMessage(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof WebhookTransportError && Object.hasOwn(FAILURE_MESSAGES, value.code)) {
    return FAILURE_MESSAGES[value.code];
  }
  if (
    typeof value === 'string' &&
    (Object.values(FAILURE_MESSAGES).some((message) => message === value) ||
      value === 'Recovered stale processing attempt.')
  ) {
    return value;
  }
  return FAILURE_MESSAGES['processing-failed'];
}
