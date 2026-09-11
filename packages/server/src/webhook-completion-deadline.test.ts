import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { NodeWebhookSender } from './modules/eventing/infrastructure/http/node-webhook-sender';
import { WebhookTransportError } from './modules/eventing/domain/webhook-diagnostics';

// Keep real sockets and timers. Only the monotonic clock advances at the peer's
// response boundary. The real 30-second timer cannot explain a passing 3-second
// test, and no busy loop or timing-sensitive event-loop race is needed.
const timeoutMilliseconds = 30_000;
const responseKinds = ['empty', 'body', 'declared-large', 'chunked-large'] as const;

for (const kind of responseKinds) {
  for (const elapsed of [timeoutMilliseconds - 1, timeoutMilliseconds, timeoutMilliseconds + 1]) {
    test(`completion deadline: ${kind} at ${elapsed}ms`, { timeout: 3_000 }, async (t) => {
      let monotonicNow = 0;
      const clock = t.mock.method(performance, 'now', () => monotonicNow);
      const sockets = new Set<Socket>();
      let requests = 0;
      const server = createServer((req, res) => {
        requests += 1;
        req.resume();
        monotonicNow = elapsed;
        if (kind === 'empty') {
          res.writeHead(204);
          res.end();
        } else if (kind === 'body') {
          res.end('small response');
        } else if (kind === 'declared-large') {
          res.writeHead(200, { 'content-length': '1000000' });
          res.flushHeaders();
        } else {
          res.writeHead(200);
          res.write('x'.repeat(256));
          res.end();
        }
      });
      server.on('connection', (socket: Socket) => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
      });
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', resolve);
        });
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        const sender = new NodeWebhookSender({
          allowHttp: true,
          allowPrivateNetwork: true,
          maximumResponseBytes: 128,
        });
        const result = sender.send({
          url: `http://127.0.0.1:${address.port}/callback`,
          body: '{}',
          headers: {},
          timeoutMilliseconds,
        });
        if (elapsed < timeoutMilliseconds) {
          assert.equal((await result).status, kind === 'empty' ? 204 : 200);
        } else {
          await assert.rejects(result, (error: unknown) => {
            assert.ok(error instanceof WebhookTransportError);
            assert.equal(error.code, 'deadline-exceeded');
            return true;
          });
        }
        assert.equal(requests, 1, 'The response boundary, not DNS rejection, must be reached.');
        for (let i = 0; i < 100 && sockets.size > 0; i += 1) await delay(10);
        assert.equal(sockets.size, 0, 'Completion must close the request socket.');
      } finally {
        clock.mock.restore();
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  }
}
