import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createUuidV7 } from '@atlas/server';

import { readPositiveIntegerJobField, readUuidJobField } from './processors/system-queue.worker';

test('System Queue validates UUIDv7 and positive attempt fields before dispatch', () => {
  const id = createUuidV7(1);
  const job = {
    name: 'webhook.deliver',
    data: { deliveryId: id, attemptNumber: 2 },
  };

  assert.equal(readUuidJobField(job, 'deliveryId'), id);
  assert.equal(readPositiveIntegerJobField(job, 'attemptNumber'), 2);
  assert.throws(() => readUuidJobField({ ...job, data: { deliveryId: 'invalid' } }, 'deliveryId'));
  assert.throws(() =>
    readPositiveIntegerJobField({ ...job, data: { attemptNumber: 0 } }, 'attemptNumber'),
  );
  assert.throws(() =>
    readPositiveIntegerJobField({ ...job, data: { attemptNumber: '2' } }, 'attemptNumber'),
  );
});
