import { createHash } from 'node:crypto';

export async function verifyAssetUploadFoundation({ request, session, assertEqual }) {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
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

  const ready = await waitForReadyAsset(request, completed.data.id, session.cookieHeader);
  assertAsset(ready, 'ready');
  assertNoStorageInternals(ready, 'READY Asset');

  if (
    !Number.isSafeInteger(ready.width) ||
    ready.width < 1 ||
    !Number.isSafeInteger(ready.height) ||
    ready.height < 1 ||
    typeof ready.processedAt !== 'string' ||
    ready.processingFailureCode !== null
  ) {
    throw new Error('READY Asset processing metadata is invalid.');
  }

  const listed = await request('/admin/v1/assets?limit=100', {
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
  });

  if (
    !Array.isArray(listed.data.items) ||
    !listed.data.items.some((asset) => asset.id === ready.id && asset.status === 'ready')
  ) {
    throw new Error('READY Asset is missing from the Workspace list.');
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
    throw new Error(
      `Invalid-fixture PUT failed before server verification: ${invalidUpload.status}`,
    );
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

async function waitForReadyAsset(request, assetId, cookieHeader) {
  let lastStatus = 'unknown';

  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const response = await request(`/admin/v1/assets/${assetId}`, {
      expectedStatus: 200,
      cookieHeader,
    });
    lastStatus = response.data?.status ?? 'unknown';

    if (lastStatus === 'ready') {
      return response.data;
    }

    if (lastStatus === 'failed') {
      throw new Error(
        `Asset processing failed: ${response.data?.processingFailureCode ?? 'unknown failure'}`,
      );
    }

    await delay(500);
  }

  throw new Error(`Asset did not become READY. Last status: ${lastStatus}.`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
