import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('apps/api/package.json'));
require('reflect-metadata');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const {
  ConsumerController,
  ConsumerReplayDto,
  ConsumerQueryDto,
} = require('./dist/eventing/consumer.controller.js');
const { AdminPermission, createUuidV7 } = require('@atlas/server');
const options = { whitelist: true, forbidNonWhitelisted: true };
for (const method of ['list', 'history', 'replay']) {
  const handler = ConsumerController.prototype[method];
  const guards = Reflect.getMetadata('__guards__', handler).map((x) => x.name);
  assert.deepEqual(
    guards,
    method === 'replay'
      ? ['AdminSessionGuard', 'AdminWorkspaceGuard', 'AdminCsrfGuard', 'AdminPermissionGuard']
      : ['AdminSessionGuard', 'AdminWorkspaceGuard', 'AdminPermissionGuard'],
  );
  assert.equal(
    Reflect.getMetadata('atlas:admin-permission', handler),
    method === 'replay' ? AdminPermission.SITES_MANAGE : AdminPermission.SITES_READ,
  );
}
const good = { replayId: createUuidV7(), expectedAttempt: 5, reason: 'operator-reviewed' };
assert.equal((await validate(plainToInstance(ConsumerReplayDto, good), options)).length, 0);
for (const patch of [
  { replayId: 'invalid' },
  { expectedAttempt: '5' },
  { expectedAttempt: 0 },
  { reason: 'arbitrary secret' },
  { payload: {} },
]) {
  assert.ok(
    (await validate(plainToInstance(ConsumerReplayDto, { ...good, ...patch }), options)).length > 0,
  );
}
for (const query of [
  { limit: '0' },
  { limit: '201' },
  { status: 'arbitrary' },
  { limit: 5 },
  { payload: 'forbidden' },
]) {
  assert.ok((await validate(plainToInstance(ConsumerQueryDto, query), options)).length > 0);
}
assert.equal(
  (await validate(plainToInstance(ConsumerQueryDto, { limit: '200', status: 'dead' }), options))
    .length,
  0,
);
console.log(
  'Consumer API guard metadata and DTO contract assertions passed (not an authenticated HTTP E2E).',
);
