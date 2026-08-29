import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import {
  ActorType,
  AtlasLogLevel,
  REDACTED_LOG_VALUE,
  createAtlasLogger,
  requestContext,
} from './index';

test('AtlasLogger adds execution context and redacts structured secrets', () => {
  const { destination, records } = createCapture();
  const logger = createAtlasLogger(
    {
      service: 'atlas-test',
      environment: 'test',
      level: AtlasLogLevel.TRACE,
    },
    destination,
  );

  requestContext.run(
    {
      requestId: 'request-1',
      traceId: 'trace-1',
      correlationId: 'correlation-1',
      actorType: ActorType.ADMIN,
      actorId: 'admin-1',
      workspaceId: 'workspace-1',
      siteId: 'site-1',
    },
    () => {
      logger.write(
        AtlasLogLevel.INFO,
        {
          event: 'auth.login',
          password: 'never-log-this',
          nested: {
            refreshToken: 'never-log-this-either',
          },
          request: {
            headers: {
              authorization: 'Bearer credential',
            },
          },
        },
        'Login completed with token=free-form-secret.',
      );
    },
  );

  assert.equal(records.length, 1);
  const record = records[0] ?? {};
  assert.equal(record.service, 'atlas-test');
  assert.equal(record.environment, 'test');
  assert.equal(record.level, 'info');
  assert.equal(record.requestId, 'request-1');
  assert.equal(record.traceId, 'trace-1');
  assert.equal(record.actorType, ActorType.ADMIN);
  assert.equal(record.password, REDACTED_LOG_VALUE);
  assert.deepEqual(record.nested, { refreshToken: REDACTED_LOG_VALUE });
  assert.deepEqual(record.request, {
    headers: { authorization: REDACTED_LOG_VALUE },
  });
  assert.equal(record.message, `Login completed with token=${REDACTED_LOG_VALUE}`);
});

test('AtlasLogger redacts credentials from error messages and stacks', () => {
  const { destination, records } = createCapture();
  const logger = createAtlasLogger(
    {
      service: 'atlas-test',
      environment: 'test',
      level: AtlasLogLevel.TRACE,
    },
    destination,
  );
  const error = new Error('Request failed with Bearer secret-token');

  logger.write(AtlasLogLevel.ERROR, { event: 'request.failed' }, 'Request failed.', error);

  assert.equal(records.length, 1);
  const record = records[0] ?? {};
  const serializedError = record.err as Record<string, unknown>;
  assert.equal(serializedError.message, `Request failed with Bearer ${REDACTED_LOG_VALUE}`);
  assert.equal(String(serializedError.stack).includes('secret-token'), false);
});

function createCapture(): {
  destination: PassThrough;
  records: Array<Record<string, unknown>>;
} {
  const destination = new PassThrough();
  const records: Array<Record<string, unknown>> = [];

  destination.on('data', (chunk: Buffer) => {
    const lines = chunk
      .toString('utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      records.push(JSON.parse(line) as Record<string, unknown>);
    }
  });

  return { destination, records };
}
