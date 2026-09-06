import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONSUMER_ATTEMPTS_PER_CYCLE, CONSUMER_NOTIFICATION_LEASE_MS, retryDelay } from './modules/eventing/ports/consumer-lifecycle';

test('Consumer retry delays are bounded and restart per replay, not by total attempts', () => {
  assert.equal(CONSUMER_ATTEMPTS_PER_CYCLE, 5);
  assert.deepEqual([1, 2, 3, 4].map((n) => retryDelay(n, 0)), [5_000, 30_000, 120_000, 600_000]);
  assert.equal(retryDelay(6, 5), 5_000);
  assert.equal(retryDelay(99, 0), 600_000);
  assert.ok(CONSUMER_NOTIFICATION_LEASE_MS > 0);
});
for (const [attempt, start] of [[0, 0], [1, 1], [1.5, 0], [2, -1], [NaN, 0], [1, Infinity]]) {
  test(`Consumer retry counters fail closed (${attempt},${start})`, () => {
    assert.throws(() => retryDelay(attempt!, start!));
  });
}
