import assert from 'node:assert/strict';
import test from 'node:test';

import { ErrorCode } from './core';
import {
  DeploymentStatus,
  assertDeploymentProgress,
  normalizeCommitSha,
  normalizeHealthUrl,
  normalizeIdempotencyKey,
  normalizeMetadata,
  normalizeProjectSiteIds,
} from './modules/project-deployment';

test('Project and Deployment identifiers are normalized at the shared server boundary', () => {
  assert.equal(normalizeCommitSha('ABCDEF1234567'), 'abcdef1234567');
  assert.equal(normalizeIdempotencyKey(' deploy-atlas-2026-08-30 '), 'deploy-atlas-2026-08-30');
  assert.deepEqual(
    normalizeProjectSiteIds([
      '01990000-0000-7000-8000-000000000002',
      '01990000-0000-7000-8000-000000000001',
    ]),
    ['01990000-0000-7000-8000-000000000001', '01990000-0000-7000-8000-000000000002'],
  );
});

test('Deployment terminal status and Health configuration remain separate concerns', () => {
  assert.doesNotThrow(() =>
    assertDeploymentProgress(DeploymentStatus.RUNNING, DeploymentStatus.SUCCEEDED),
  );
  assert.throws(
    () => assertDeploymentProgress(DeploymentStatus.SUCCEEDED, DeploymentStatus.RUNNING),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === ErrorCode.INVALID_STATE_TRANSITION,
  );

  assert.equal(normalizeHealthUrl('https://example.com/health'), 'https://example.com/health');
  assert.throws(() => normalizeHealthUrl('https://user:secret@example.com/health'));
});

test('Deployment metadata must remain a bounded JSON object', () => {
  assert.deepEqual(normalizeMetadata({ stage: 'deploy', attempt: 1 }), {
    stage: 'deploy',
    attempt: 1,
  });
  assert.throws(() => normalizeMetadata([] as unknown as Record<string, unknown>));
});
