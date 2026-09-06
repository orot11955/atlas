import { lookup } from 'node:dns/promises';
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';

import { isPrivateHostname, normalizeWebhookUrl } from '../../domain/eventing';
import {
  WEBHOOK_RESPONSE_OMITTED,
  WEBHOOK_RESPONSE_TOO_LARGE,
  WebhookTransportError,
} from '../../domain/webhook-diagnostics';
import type {
  WebhookSenderPort,
  WebhookSendRequest,
  WebhookSendResponse,
} from '../../ports/webhook-sender.port';

type PinnedAddress = Readonly<{ address: string; family: 4 | 6 }>;
export type WebhookAddressResolver = (
  hostname: string,
) => Promise<readonly Readonly<{ address: string; family: number }>[]>;

export class NodeWebhookSender implements WebhookSenderPort {
  public constructor(
    private readonly options: Readonly<{
      allowHttp: boolean;
      allowPrivateNetwork: boolean;
      maximumResponseBytes?: number;
    }>,
    // Trusted composition/test seam, never a setting supplied by a Webhook endpoint.
    private readonly resolveAddresses: WebhookAddressResolver = (hostname) =>
      lookup(hostname, { all: true, verbatim: true }),
  ) {
    const maximum = options.maximumResponseBytes ?? 2_000;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1_048_576) {
      throw new Error('Webhook response byte limit must be between 1 and 1048576.');
    }
  }

  public async send(request: Readonly<WebhookSendRequest>): Promise<Readonly<WebhookSendResponse>> {
    if (
      !Number.isSafeInteger(request.timeoutMilliseconds) ||
      request.timeoutMilliseconds < 1 ||
      request.timeoutMilliseconds > 120_000 ||
      typeof request.body !== 'string' ||
      Buffer.byteLength(request.body, 'utf8') > 1_048_576
    ) {
      throw new WebhookTransportError('processing-failed');
    }
    const controller = new AbortController();
    const expiresAt = performance.now() + request.timeoutMilliseconds;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new WebhookTransportError('deadline-exceeded'));
      }, request.timeoutMilliseconds);
    });
    const assertLive = () => {
      if (controller.signal.aborted || performance.now() >= expiresAt) {
        throw new WebhookTransportError('deadline-exceeded');
      }
    };
    try {
      const response = await Promise.race([
        this.sendBeforeDeadline(request, controller.signal, assertLive),
        deadline,
      ]);
      // A response callback may run before an overdue timer callback. Recheck the
      // monotonic deadline at the public completion boundary, including body-limit exits.
      assertLive();
      return response;
    } catch (error) {
      if (controller.signal.aborted) throw new WebhookTransportError('deadline-exceeded');
      if (error instanceof WebhookTransportError) throw error;
      throw new WebhookTransportError('transport-failed');
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  private async sendBeforeDeadline(
    request: Readonly<WebhookSendRequest>,
    signal: AbortSignal,
    assertLive: () => void,
  ): Promise<Readonly<WebhookSendResponse>> {
    let url: URL;
    try {
      url = new URL(normalizeWebhookUrl(request.url, this.options));
    } catch {
      throw new WebhookTransportError('target-rejected');
    }
    assertLive();
    const target = await this.resolveAllowedAddress(url.hostname);
    // OS lookup cannot be cancelled. A late result MUST NOT start a network request.
    assertLive();
    return sendPinnedRequest(
      url,
      target,
      Buffer.from(request.body, 'utf8'),
      request,
      signal,
      this.options.maximumResponseBytes ?? 2_000,
    );
  }

  private async resolveAllowedAddress(hostnameValue: string): Promise<PinnedAddress> {
    const hostname = hostnameValue.replace(/^\[|\]$/gu, '');
    if (!this.options.allowPrivateNetwork && isPrivateHostname(hostname)) {
      throw new WebhookTransportError('target-rejected');
    }
    const literalFamily = isIP(hostname);
    if (literalFamily === 4 || literalFamily === 6) {
      return { address: hostname, family: literalFamily };
    }
    let addresses: Awaited<ReturnType<WebhookAddressResolver>>;
    try {
      addresses = await this.resolveAddresses(hostname);
    } catch {
      throw new WebhookTransportError('dns-failed');
    }
    if (
      addresses.length === 0 ||
      addresses.some(
        (candidate) =>
          (candidate.family !== 4 && candidate.family !== 6) ||
          isIP(candidate.address) !== candidate.family ||
          (!this.options.allowPrivateNetwork && isPrivateHostname(candidate.address)),
      )
    ) {
      throw new WebhookTransportError('target-rejected');
    }
    const selected = addresses[0]!;
    return { address: selected.address, family: selected.family as 4 | 6 };
  }
}

function sendPinnedRequest(
  url: URL,
  target: PinnedAddress,
  body: Buffer,
  request: Readonly<WebhookSendRequest>,
  signal: AbortSignal,
  maximumBytes: number,
): Promise<Readonly<WebhookSendResponse>> {
  const hostname = url.hostname.replace(/^\[|\]$/gu, '');
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const options: RequestOptions = {
    protocol: url.protocol,
    hostname: target.address,
    family: target.family,
    port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
    method: 'POST',
    path: `${url.pathname}${url.search}`,
    servername: url.protocol === 'https:' && !isIP(hostname) ? hostname : undefined,
    rejectUnauthorized: true,
    agent: false,
    signal,
    maxHeaderSize: 16_384,
    headers: {
      ...request.headers,
      host: url.host,
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(body.byteLength),
      'user-agent': 'Atlas-Webhook/1.0',
    },
  };
  return new Promise((resolve, reject) => {
    let outgoing: ClientRequest | undefined;
    let incoming: IncomingMessage | undefined;
    let settled = false;
    const finish = (result?: Readonly<WebhookSendResponse>, error?: WebhookTransportError) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      incoming?.destroy();
      outgoing?.destroy();
      if (error) reject(error);
      else resolve(Object.freeze(result!));
    };
    const abort = () => finish(undefined, new WebhookTransportError('deadline-exceeded'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    try {
      outgoing = transport(options, (response) => {
        incoming = response;
        const status = response.statusCode ?? 0;
        const incomplete = () =>
          finish(undefined, new WebhookTransportError('response-incomplete'));
        response.on('error', incomplete);
        response.once('aborted', incomplete);
        response.once('close', () => {
          if (!response.complete) incomplete();
        });
        if (settled) {
          response.destroy();
          return;
        }
        if (!Number.isInteger(status) || status < 100 || status > 599) {
          finish(undefined, new WebhookTransportError('invalid-response'));
          return;
        }
        const tooLarge = () => finish({ status, bodyExcerpt: WEBHOOK_RESPONSE_TOO_LARGE });
        const declaredLength = Number(response.headers['content-length']);
        if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
          tooLarge();
          return;
        }
        let receivedBytes = 0;
        response.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.byteLength;
          if (receivedBytes > maximumBytes) tooLarge();
        });
        response.once('end', () => {
          if (!response.complete) incomplete();
          else {
            finish({
              status,
              ...(receivedBytes > 0 ? { bodyExcerpt: WEBHOOK_RESPONSE_OMITTED } : {}),
            });
          }
        });
      });
      outgoing.on('error', () => finish(undefined, new WebhookTransportError('transport-failed')));
      outgoing.end(body);
    } catch {
      finish(undefined, new WebhookTransportError('transport-failed'));
    }
  });
}
