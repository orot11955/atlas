import { createHash } from 'node:crypto';

export async function verifyAssetUploadFoundation({ request, session, assertEqual }) {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('atlas-phase-8-private-original'),
  ]);
  const sha256 = createHash('sha256').update(png).digest('hex');

  await request('/admin/v1/assets/upload-sessions', {
    method: 'POST',
    body: {
      fileName: 'missing-csrf.png',
      contentType: 'image/png',
      size: png.length,
      sha256,
    },
    expectedStatus: 403,
    cookieHeader: session.cookieHeader,
  });

  const created = await request('/admin/v1/assets/upload-sessions', {
    method: 'POST',
    body: {
      fileName: 'atlas-phase-8.png',
      contentType: 'image/png',
      size: png.length,
      sha256,
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });

  assertAsset(created.data.asset, 'uploading');
  assertEqual(created.data.upload.method, 'PUT', 'Asset upload method');

  if (
    typeof created.data.upload.url !== 'string' ||
    !created.data.upload.url.startsWith('http://localhost:9000/') ||
    created.data.upload.headers?.['Content-Type'] !== 'image/png' ||
    typeof created.data.uploadSession?.id !== 'string'
  ) {
    throw new Error('Asset Upload Session response is invalid.');
  }

  assertNoStorageInternals(created.data.asset, 'created Asset');
  assertNoStorageInternals(created.data.uploadSession, 'created Upload Session');

  const uploadResponse = await fetch(created.data.upload.url, {
    method: 'PUT',
    headers: created.data.upload.headers,
    body: png,
  });

  if (!uploadResponse.ok) {
    throw new Error(
      `Presigned Asset PUT failed with ${uploadResponse.status}: ${await uploadResponse.text()}`,
    );
  }

  const completed = await request(
    `/admin/v1/assets/upload-sessions/${created.data.uploadSession.id}/complete`,
    {
      method: 'POST',
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    },
  );
  assertAsset(completed.data, 'uploaded');
  assertEqual(completed.data.actualSize, png.length, 'Uploaded Asset size');
  assertEqual(completed.data.detectedContentType, 'image/png', 'Detected Asset Content-Type');
  assertNoStorageInternals(completed.data, 'completed Asset');

  const completedAgain = await request(
    `/admin/v1/assets/upload-sessions/${created.data.uploadSession.id}/complete`,
    {
      method: 'POST',
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    },
  );
  assertEqual(completedAgain.data.id, completed.data.id, 'Idempotent Asset completion');

  const listed = await request('/admin/v1/assets?limit=100', {
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
  });

  if (
    !Array.isArray(listed.data.items) ||
    !listed.data.items.some((asset) => asset.id === completed.data.id)
  ) {
    throw new Error('Uploaded Asset is missing from the Workspace list.');
  }
  assertNoStorageInternals(listed.data, 'Asset list');

  const invalidBody = Buffer.from('<svg><script>alert(1)</script></svg>');
  const invalidCreated = await request('/admin/v1/assets/upload-sessions', {
    method: 'POST',
    body: {
      fileName: 'disguised.png',
      contentType: 'image/png',
      size: invalidBody.length,
      sha256: createHash('sha256').update(invalidBody).digest('hex'),
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  const invalidUpload = await fetch(invalidCreated.data.upload.url, {
    method: 'PUT',
    headers: invalidCreated.data.upload.headers,
    body: invalidBody,
  });

  if (!invalidUpload.ok) {
    throw new Error(`Invalid-fixture PUT failed before server verification: ${invalidUpload.status}`);
  }

  await request(
    `/admin/v1/assets/upload-sessions/${invalidCreated.data.uploadSession.id}/complete`,
    {
      method: 'POST',
      expectedStatus: 400,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    },
  );
}

function assertAsset(value, status) {
  if (
    !value ||
    typeof value.id !== 'string' ||
    value.kind !== 'image' ||
    value.status !== status ||
    typeof value.originalFileName !== 'string' ||
    typeof value.sha256 !== 'string' ||
    typeof value.version !== 'number'
  ) {
    throw new Error(`Asset response is invalid for status ${status}.`);
  }
}

function assertNoStorageInternals(value, label) {
  const serialized = JSON.stringify(value);

  for (const forbidden of [
    'originalObjectKey',
    'temporaryObjectKey',
    'privateBucket',
    'processingBucket',
  ]) {
    if (serialized.includes(forbidden)) {
      throw new Error(`${label} exposes forbidden storage field ${forbidden}.`);
    }
  }
}
