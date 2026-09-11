import { randomBytes } from 'node:crypto';

import type { WebhookSecretGeneratorPort } from '../../ports/webhook-secret-generator.port';

export class NodeWebhookSecretGenerator implements WebhookSecretGeneratorPort {
  public generate(): string {
    return randomBytes(32).toString('base64url');
  }
}
