import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';

import { isPrivateHostname, normalizeWebhookUrl } from '../../domain/eventing';
import type {
  WebhookSenderPort,
  WebhookSendRequest,
  WebhookSendResponse,
} from '../../ports/webhook-sender.port';

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export class NodeWebhookSender implements WebhookSenderPort {
  public constructor(
    private readonly options: Readonly<{
      allowHttp: boolean;
      allowPrivateNetwork: boolean;
      maximumResponseBytes?: number;
    }>,
  ) {}

  public async send(request: Readonly<WebhookSendRequest>): Promise<Readonly<WebhookSendResponse>> {
    const normalizedUrl = normalizeWebhookUrl(request.url, this.options);
    const url = new URL(normalizedUrl);
    const target = await this.resolveAllowedAddress(url.hostname);
    const body = Buffer.from(request.body, 'utf8');
    const response = await sendPinnedRequest(url, target, body, request);
    const bodyExcerpt = await readResponseExcerpt(
      response,
      this.options.maximumResponseBytes ?? 2_000,
    );

    return Object.freeze({
      status: response.statusCode ?? 0,
      ...(bodyExcerpt ? { bodyExcerpt } : {}),
    });
  }

  private async resolveAllowedAddress(hostnameValue: string): Promise<ResolvedAddress> {
    const hostname = hostnameValue.replace(/^\[|\]$/gu, '');
    const family = isIP(hostname);

    if (family !== 0) {
      if (!this.options.allowPrivateNetwork && isPrivateHostname(hostname)) {
        throw new Error('Webhook URL resolved to a private network host.');
      }

      return { address: hostname, family };
    }

    if (!this.options.allowPrivateNetwork && isPrivateHostname(hostname)) {
      throw new Error('Webhook URL resolved to a private network host.');
    }

    const addresses = await lookup(hostname, { all: true, verbatim: true });

    if (addresses.length < 1) {
      throw new Error('Webhook URL hostname did not resolve to an address.');
    }

    if (
      !this.options.allowPrivateNetwork &&
      addresses.some((candidate) => isPrivateHostname(candidate.address))
    ) {
      throw new Error('Webhook URL resolved to a private network address.');
    }

    const selected = addresses[0];
    if (!selected || (selected.family !== 4 && selected.family !== 6)) {
      throw new Error('Webhook URL resolved to an unsupported address family.');
    }

    return { address: selected.address, family: selected.family };
  }
}

function sendPinnedRequest(
  url: URL,
  target: Readonly<ResolvedAddress>,
  body: Buffer,
  request: Readonly<WebhookSendRequest>,
): Promise<IncomingMessage> {
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const options: RequestOptions = {
    protocol: url.protocol,
    hostname: target.address,
    family: target.family,
    port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
    method: 'POST',
    path: `${url.pathname}${url.search}`,
    servername: url.protocol === 'https:' ? url.hostname.replace(/^\[|\]$/gu, '') : undefined,
    headers: {
      host: url.host,
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(body.byteLength),
      'user-agent': 'Atlas-Webhook/1.0',
      ...request.headers,
    },
  };

  return new Promise((resolve, reject) => {
    const outgoing = transport(options, resolve);

    outgoing.once('error', reject);
    outgoing.setTimeout(request.timeoutMilliseconds, () => {
      outgoing.destroy(new Error('Webhook request timed out.'));
    });
    outgoing.end(body);
  });
}

async function readResponseExcerpt(
  response: IncomingMessage,
  maximumBytes: number,
): Promise<string> {
  const contentLength = Number(response.headers['content-length'] ?? 0);

  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    response.resume();
    return '[response body omitted: too large]';
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const value of response) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    totalBytes += chunk.byteLength;

    if (totalBytes > maximumBytes) {
      response.destroy();
      return '[response body omitted: too large]';
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks, totalBytes)
    .toString('utf8')
    .replace(/[\r\n\t]+/gu, ' ')
    .trim();
}
