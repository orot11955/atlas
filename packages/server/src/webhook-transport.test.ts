import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { createServer as tcpServer, type Server, type Socket } from 'node:net';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import {
  NodeWebhookSender,
  type WebhookAddressResolver,
} from './modules/eventing/infrastructure/http/node-webhook-sender';
import {
  WEBHOOK_RESPONSE_OMITTED,
  WEBHOOK_RESPONSE_TOO_LARGE,
  WebhookTransportError,
  type WebhookFailureCode,
} from './modules/eventing/domain/webhook-diagnostics';

const secret = 'remote-response-secret-marker';
const localOptions = { allowHttp: true, allowPrivateNetwork: true, maximumResponseBytes: 128 };
const request = (url: string, timeoutMilliseconds = 1_000) => ({
  url,
  timeoutMilliseconds,
  body: '{"event":"fixture"}',
  headers: { 'x-atlas-signature': 'v1=fixture-signature' },
});
const rejectsWith = (code: WebhookFailureCode) => (error: unknown) => {
  assert.ok(error instanceof WebhookTransportError);
  assert.equal(error.code, code);
  assert.doesNotMatch(error.message, /remote-response-secret-marker/u);
  return true;
};

async function peer(server: Server) {
  const sockets = new Set<Socket>();
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    async disconnected() {
      for (let i = 0; i < 100 && sockets.size; i += 1) await delay(10);
      assert.equal(sockets.size, 0, 'Sender must release its socket.');
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test(
  'DNS deadline returns before lookup settles and a late result never sends',
  { timeout: 3_000 },
  async () => {
    let received = 0;
    const target = await peer(
      httpServer((_req, res) => {
        received += 1;
        res.end();
      }),
    );
    let release!: (value: Awaited<ReturnType<WebhookAddressResolver>>) => void;
    const pending = new Promise<Awaited<ReturnType<WebhookAddressResolver>>>((resolve) => {
      release = resolve;
    });
    const sender = new NodeWebhookSender(localOptions, () => pending);
    try {
      await assert.rejects(
        sender.send(request(`http://hooks.example.com:${target.port}`, 40)),
        rejectsWith('deadline-exceeded'),
      );
      release([{ address: '127.0.0.1', family: 4 }]);
      await delay(30);
      assert.equal(received, 0);
    } finally {
      await target.close();
    }
  },
);

test(
  'DNS and response headers share one deadline rather than separate budgets',
  { timeout: 3_000 },
  async () => {
    const target = await peer(
      httpServer((_req, res) => {
        const timer = setTimeout(() => res.end(), 160);
        res.once('close', () => clearTimeout(timer));
      }),
    );
    const sender = new NodeWebhookSender(localOptions, async () => {
      await delay(80);
      return [{ address: '127.0.0.1', family: 4 }];
    });
    try {
      const started = performance.now();
      await assert.rejects(
        sender.send(request(`http://hooks.example.com:${target.port}`, 200)),
        rejectsWith('deadline-exceeded'),
      );
      assert.ok(performance.now() - started < 1_500);
      await target.disconnected();
    } finally {
      await target.close();
    }
  },
);

test(
  'slow headers cannot retain a socket past the total deadline',
  { timeout: 3_000 },
  async () => {
    const target = await peer(httpServer(() => {}));
    try {
      await assert.rejects(
        new NodeWebhookSender(localOptions).send(request(target.url, 50)),
        rejectsWith('deadline-exceeded'),
      );
      await target.disconnected();
    } finally {
      await target.close();
    }
  },
);

test(
  'continuously trickled response bytes do not extend the deadline',
  { timeout: 3_000 },
  async () => {
    const target = await peer(
      httpServer((_req, res) => {
        res.writeHead(200);
        res.flushHeaders();
        const timer = setInterval(() => res.write('x'), 10);
        res.once('close', () => clearInterval(timer));
      }),
    );
    try {
      await assert.rejects(
        new NodeWebhookSender(localOptions).send(request(target.url, 80)),
        rejectsWith('deadline-exceeded'),
      );
      await target.disconnected();
    } finally {
      await target.close();
    }
  },
);

test('TLS handshake stalls are bounded by the same deadline', { timeout: 3_000 }, async () => {
  const target = await peer(tcpServer((socket) => socket.on('data', () => {})));
  try {
    await assert.rejects(
      new NodeWebhookSender(localOptions).send(request(`https://127.0.0.1:${target.port}`, 80)),
      rejectsWith('deadline-exceeded'),
    );
    await target.disconnected();
  } finally {
    await target.close();
  }
});

for (const declared of [true, false]) {
  test(
    `oversized ${declared ? 'declared' : 'chunked'} response is closed without draining`,
    { timeout: 3_000 },
    async () => {
      const target = await peer(
        httpServer((_req, res) => {
          res.writeHead(200, declared ? { 'content-length': '1000000' } : {});
          res.flushHeaders();
          const timer = setInterval(() => res.write(secret.repeat(20)), 10);
          res.once('close', () => clearInterval(timer));
        }),
      );
      try {
        const response = await new NodeWebhookSender(localOptions).send(request(target.url));
        assert.deepEqual(response, { status: 200, bodyExcerpt: WEBHOOK_RESPONSE_TOO_LARGE });
        await target.disconnected();
      } finally {
        await target.close();
      }
    },
  );
}

test('pinned host, signature and body survive transport without retaining the response', async () => {
  let captured: { host?: string; signature?: string; body: string } | undefined;
  const target = await peer(
    httpServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        captured = {
          host: req.headers.host,
          signature: req.headers['x-atlas-signature'] as string,
          body,
        };
        res.end(secret);
      });
    }),
  );
  const sender = new NodeWebhookSender(localOptions, async () => [
    { address: '127.0.0.1', family: 4 },
  ]);
  try {
    const input = request(`http://hooks.example.com:${target.port}/callback`);
    const response = await sender.send({
      ...input,
      headers: { ...input.headers, Host: 'attacker.invalid', 'content-length': '0' },
    });
    assert.deepEqual(captured, {
      host: `hooks.example.com:${target.port}`,
      signature: input.headers['x-atlas-signature'],
      body: input.body,
    });
    assert.deepEqual(response, { status: 200, bodyExcerpt: WEBHOOK_RESPONSE_OMITTED });
    assert.ok(Object.isFrozen(response));
  } finally {
    await target.close();
  }
});

test('empty response has no body diagnostic', async () => {
  const target = await peer(
    httpServer((_req, res) => {
      res.writeHead(204);
      res.end();
    }),
  );
  try {
    assert.deepEqual(await new NodeWebhookSender(localOptions).send(request(target.url)), {
      status: 204,
    });
  } finally {
    await target.close();
  }
});

test('redirects are reported without following their destination', async () => {
  let received = 0;
  const target = await peer(
    httpServer((_req, res) => {
      received += 1;
      res.writeHead(302, { location: '/private' });
      res.end();
    }),
  );
  try {
    assert.equal((await new NodeWebhookSender(localOptions).send(request(target.url))).status, 302);
    assert.equal(received, 1);
  } finally {
    await target.close();
  }
});

test(
  'truncated response fails rather than acknowledging an incomplete body',
  { timeout: 3_000 },
  async () => {
    const target = await peer(
      httpServer((_req, res) => {
        res.writeHead(200, { 'content-length': '64' });
        res.write('x');
        const timer = setTimeout(() => res.destroy(), 30);
        res.once('close', () => clearTimeout(timer));
      }),
    );
    try {
      await assert.rejects(
        new NodeWebhookSender(localOptions).send(request(target.url)),
        rejectsWith('response-incomplete'),
      );
    } finally {
      await target.close();
    }
  },
);

test('mixed public/private DNS answers and unsafe URL policies fail before connection', async () => {
  const sender = new NodeWebhookSender(
    { allowHttp: false, allowPrivateNetwork: false },
    async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ],
  );
  for (const url of [
    'https://hooks.example.com',
    'http://hooks.example.com',
    'https://127.0.0.1',
    'https://user:password@hooks.example.com',
  ]) {
    await assert.rejects(sender.send(request(url)), rejectsWith('target-rejected'));
  }
});

test('DNS failure messages never echo resolver input', async () => {
  const sender = new NodeWebhookSender(localOptions, async () => {
    throw new Error(secret);
  });
  await assert.rejects(sender.send(request('http://hooks.example.com')), rejectsWith('dns-failed'));
});

test('unbounded or invalid timeout and response limits are rejected', async () => {
  const sender = new NodeWebhookSender(localOptions);
  for (const timeout of [0, -1, 1.5, Number.NaN, Infinity, 120_001]) {
    await assert.rejects(
      sender.send(request('http://127.0.0.1', timeout)),
      rejectsWith('processing-failed'),
    );
  }
  for (const maximumResponseBytes of [0, -1, 1.5, Number.NaN, Infinity, 1_048_577]) {
    assert.throws(() => new NodeWebhookSender({ ...localOptions, maximumResponseBytes }));
  }
});
