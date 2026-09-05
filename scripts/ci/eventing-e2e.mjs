import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

export async function verifyEventing({ request, session, mainBlog, assertEqual }) {
  const receiver = await createWebhookReceiver();

  try {
    const endpointInput = {
      siteId: mainBlog.id,
      name: 'Atlas Eventing E2E Receiver',
      url: receiver.url,
      subscribedEvents: ['content.published', 'content.unpublished'],
    };

    await request('/admin/v1/webhook-endpoints', {
      method: 'POST',
      body: endpointInput,
      expectedStatus: 403,
      cookieHeader: session.cookieHeader,
    });

    const created = await request('/admin/v1/webhook-endpoints', {
      method: 'POST',
      body: endpointInput,
      expectedStatus: 201,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    });
    let endpoint = created.data.endpoint;
    let secret = created.data.secret;

    if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
      throw new Error('Webhook Secret was not returned exactly once.');
    }
    assertEqual(endpoint.status, 'active', 'Webhook Endpoint status');
    assertEqual(endpoint.siteId, mainBlog.id, 'Webhook Endpoint Site');
    assertNoSecretMaterial(endpoint, 'created Webhook Endpoint');

    await request('/admin/v1/webhook-endpoints', {
      method: 'POST',
      body: endpointInput,
      expectedStatus: 409,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    });

    const updatedEndpoint = await request(`/admin/v1/webhook-endpoints/${endpoint.id}`, {
      method: 'PATCH',
      body: {
        name: 'Atlas Eventing E2E Receiver Updated',
        url: endpointInput.url,
        subscribedEvents: endpointInput.subscribedEvents,
        version: endpoint.version,
      },
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    });
    endpoint = updatedEndpoint.data;
    assertEqual(endpoint.version, 2, 'Webhook Endpoint updated version');

    await request(`/admin/v1/webhook-endpoints/${endpoint.id}`, {
      method: 'PATCH',
      body: {
        name: 'Atlas Eventing E2E Receiver Updated',
        url: endpointInput.url,
        subscribedEvents: endpointInput.subscribedEvents,
        version: 1,
      },
      expectedStatus: 409,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    });

    const listedEndpoints = await request(`/admin/v1/webhook-endpoints?siteId=${mainBlog.id}`, {
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
    });
    if (
      !Array.isArray(listedEndpoints.data.items) ||
      !listedEndpoints.data.items.some((item) => item.id === endpoint.id)
    ) {
      throw new Error('Created Webhook Endpoint is missing from the list.');
    }
    assertNoSecretMaterial(listedEndpoints.data, 'Webhook Endpoint list');

    const content = await createReadyContent(request, session, mainBlog);

    await request(`/admin/v1/contents/${content.id}/sites/${content.assignmentId}/publish`, {
      method: 'POST',
      expectedStatus: 201,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    });

    const firstFailure = await waitForDelivery(
      request,
      session,
      endpoint.id,
      (delivery) =>
        delivery.eventType === 'content.published' && delivery.status === 'retry_scheduled',
    );
    assertEqual(firstFailure.attemptCount, 1, 'Failed Webhook attempt count');
    verifyCapturedRequest(receiver.requests[0], secret, 'content.published');

    const retry = await request(`/admin/v1/webhook-deliveries/${firstFailure.id}/retry`, {
      method: 'POST',
      expectedStatus: 202,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    });
    assertEqual(retry.data.attemptNumber, 2, 'Manual Webhook retry attempt');

    const succeeded = await waitForDelivery(
      request,
      session,
      endpoint.id,
      (delivery) => delivery.id === firstFailure.id && delivery.status === 'succeeded',
    );
    assertEqual(succeeded.attemptCount, 2, 'Succeeded Webhook attempt count');
    verifyCapturedRequest(receiver.requests[1], secret, 'content.published');
    assertEqual(
      receiver.requests[1]?.eventId,
      receiver.requests[0]?.eventId,
      'Webhook retry Event ID',
    );
    assertEqual(receiver.requests[1]?.body, receiver.requests[0]?.body, 'Webhook retry raw body');

    const rotated = await request(`/admin/v1/webhook-endpoints/${endpoint.id}/secret/rotate`, {
      method: 'POST',
      body: { version: endpoint.version },
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    });
    endpoint = rotated.data.endpoint;
    secret = rotated.data.secret;
    assertNoSecretMaterial(endpoint, 'rotated Webhook Endpoint');

    const scheduledLocalAt = formatLocalDateTime(new Date(Date.now() + 45_000), 'Asia/Seoul');
    const schedule = await request(
      `/admin/v1/contents/${content.id}/sites/${content.assignmentId}/schedules`,
      {
        method: 'POST',
        body: {
          action: 'withdraw',
          scheduledLocalAt,
          timezone: 'Asia/Seoul',
        },
        expectedStatus: 201,
        cookieHeader: session.cookieHeader,
        csrfToken: session.csrfToken,
      },
    );
    assertEqual(schedule.data.status, 'pending', 'Publication Schedule status');
    assertEqual(schedule.data.action, 'withdraw', 'Publication Schedule action');

    await request(`/admin/v1/contents/${content.id}/sites/${content.assignmentId}/schedules`, {
      method: 'POST',
      body: {
        action: 'withdraw',
        scheduledLocalAt: formatLocalDateTime(new Date(Date.now() + 90_000), 'Asia/Seoul'),
        timezone: 'Asia/Seoul',
      },
      expectedStatus: 409,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    });

    await waitForSchedule(request, session, schedule.data.id, 'completed');
    await waitForReceiverEvent(receiver, 'content.unpublished', 1);
    verifyCapturedRequest(
      receiver.requests.findLast((item) => item.eventType === 'content.unpublished'),
      secret,
      'content.unpublished',
    );

    await request(`/admin/v1/contents/${content.id}/sites/${content.assignmentId}/publish`, {
      method: 'POST',
      expectedStatus: 201,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    });
    await waitForReceiverEvent(receiver, 'content.published', 3);
    verifyCapturedRequest(
      receiver.requests.findLast((item) => item.eventType === 'content.published'),
      secret,
      'content.published',
    );

    const cancellable = await request(
      `/admin/v1/contents/${content.id}/sites/${content.assignmentId}/schedules`,
      {
        method: 'POST',
        body: {
          action: 'withdraw',
          scheduledLocalAt: formatLocalDateTime(new Date(Date.now() + 120_000), 'Asia/Seoul'),
          timezone: 'Asia/Seoul',
        },
        expectedStatus: 201,
        cookieHeader: session.cookieHeader,
        csrfToken: session.csrfToken,
      },
    );
    const cancelled = await request(
      `/admin/v1/publication-schedules/${cancellable.data.id}/cancel`,
      {
        method: 'POST',
        body: { version: cancellable.data.version },
        expectedStatus: 200,
        cookieHeader: session.cookieHeader,
        csrfToken: session.csrfToken,
      },
    );
    assertEqual(cancelled.data.status, 'cancelled', 'Cancelled Publication Schedule');

    const schedules = await request(
      `/admin/v1/publication-schedules?contentId=${content.id}&contentSiteId=${content.assignmentId}&limit=100`,
      {
        expectedStatus: 200,
        cookieHeader: session.cookieHeader,
      },
    );
    if (
      !Array.isArray(schedules.data.items) ||
      !schedules.data.items.some(
        (item) => item.id === schedule.data.id && item.status === 'completed',
      ) ||
      !schedules.data.items.some(
        (item) => item.id === cancellable.data.id && item.status === 'cancelled',
      )
    ) {
      throw new Error('Publication Schedule history is invalid.');
    }

    const outbox = await waitForOutboxDispatch(request, session, mainBlog.id);
    assertNoSecretMaterial(outbox, 'Outbox list');

    endpoint = (
      await request(`/admin/v1/webhook-endpoints/${endpoint.id}/disable`, {
        method: 'POST',
        body: { version: endpoint.version },
        expectedStatus: 200,
        cookieHeader: session.cookieHeader,
        csrfToken: session.csrfToken,
      })
    ).data;
    assertEqual(endpoint.status, 'disabled', 'Disabled Webhook Endpoint');

    process.stdout.write(
      'Transactional Outbox, signed Webhook retry, Secret rotation and Publication Scheduling E2E passed.\n',
    );
  } finally {
    await receiver.close();
  }
}

async function createReadyContent(request, session, mainBlog) {
  let content = (
    await request('/admin/v1/contents', {
      method: 'POST',
      body: {
        type: 'post',
        title: 'Atlas Eventing E2E',
        summary: 'Transactional Outbox and Webhook verification',
        bodyMarkdown:
          'This READY Content verifies transactional publication events and scheduled withdrawal.',
      },
      expectedStatus: 201,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    })
  ).data;

  content = (
    await request(`/admin/v1/contents/${content.id}/ready`, {
      method: 'POST',
      body: {
        contentVersion: content.version,
        draftVersion: content.draft.draftVersion,
        note: 'Eventing E2E READY Revision',
      },
      expectedStatus: 201,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    })
  ).data;

  const assignment = (
    await request(`/admin/v1/contents/${content.id}/sites`, {
      method: 'POST',
      body: {
        siteId: mainBlog.id,
        slug: 'atlas-eventing-e2e',
        visibility: 'public',
        seo: {},
      },
      expectedStatus: 201,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    })
  ).data;

  return { ...content, assignmentId: assignment.id };
}

async function waitForDelivery(request, session, endpointId, predicate) {
  let last = [];

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await request(
      `/admin/v1/webhook-deliveries?endpointId=${endpointId}&limit=100`,
      {
        expectedStatus: 200,
        cookieHeader: session.cookieHeader,
      },
    );
    last = response.data.items ?? [];
    const delivery = last.find(predicate);
    if (delivery) return delivery;
    await delay(500);
  }

  throw new Error(`Webhook Delivery did not reach the expected state: ${JSON.stringify(last)}`);
}

async function waitForSchedule(request, session, scheduleId, expectedStatus) {
  let last;

  for (let attempt = 0; attempt < 150; attempt += 1) {
    const response = await request('/admin/v1/publication-schedules?limit=100', {
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
    });
    last = response.data.items?.find((item) => item.id === scheduleId);
    if (last?.status === expectedStatus) return last;
    if (last?.status === 'failed') {
      throw new Error(`Publication Schedule failed: ${last.lastError ?? 'unknown error'}`);
    }
    await delay(500);
  }

  throw new Error(`Publication Schedule did not become ${expectedStatus}: ${JSON.stringify(last)}`);
}

async function waitForOutboxDispatch(request, session, siteId) {
  let last = [];

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await request('/admin/v1/eventing/outbox?limit=200', {
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
    });
    last = response.data.items ?? [];
    const related = last.filter(
      (event) =>
        event.siteId === siteId &&
        ['content.published', 'content.unpublished'].includes(event.eventType),
    );
    if (related.length >= 3 && related.every((event) => event.status === 'dispatched')) {
      return response.data;
    }
    await delay(500);
  }

  throw new Error(`Outbox Events were not dispatched: ${JSON.stringify(last)}`);
}

async function createWebhookReceiver() {
  const requests = [];
  let failedPublished = false;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString('utf8');
    const item = {
      body,
      deliveryId: readHeader(request.headers['x-atlas-delivery-id']),
      eventId: readHeader(request.headers['x-atlas-event-id']),
      eventType: readHeader(request.headers['x-atlas-event']),
      signature: readHeader(request.headers['x-atlas-signature']),
      timestamp: readHeader(request.headers['x-atlas-timestamp']),
    };
    requests.push(item);

    if (item.eventType === 'content.published' && !failedPublished) {
      failedPublished = true;
      response.writeHead(503, { 'content-type': 'text/plain' });
      response.end('retry this publication event');
      return;
    }

    response.writeHead(204);
    response.end();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Webhook receiver address is invalid.');

  return {
    requests,
    url: `http://127.0.0.1:${address.port}/atlas-webhook`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function verifyCapturedRequest(request, secret, expectedEventType) {
  if (!request) throw new Error(`Webhook Receiver did not capture ${expectedEventType}.`);
  if (request.eventType !== expectedEventType) {
    throw new Error(`Expected ${expectedEventType}, received ${request.eventType}.`);
  }
  if (!request.deliveryId) {
    throw new Error('Webhook Delivery ID header is missing.');
  }
  const timestampMilliseconds = Number(request.timestamp) * 1_000;
  if (
    !Number.isFinite(timestampMilliseconds) ||
    Math.abs(Date.now() - timestampMilliseconds) > 300_000
  ) {
    throw new Error('Webhook timestamp is invalid or stale.');
  }
  const expected = `v1=${createHmac('sha256', secret)
    .update(request.timestamp, 'utf8')
    .update('.', 'utf8')
    .update(request.eventId, 'utf8')
    .update('.', 'utf8')
    .update(request.body, 'utf8')
    .digest('hex')}`;
  if (request.signature !== expected) throw new Error('Webhook HMAC signature is invalid.');
  const body = JSON.parse(request.body);
  if (body.eventId !== request.eventId || body.eventType !== expectedEventType) {
    throw new Error('Webhook envelope headers and body do not match.');
  }
}

async function waitForReceiverEvent(receiver, eventType, count) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (receiver.requests.filter((item) => item.eventType === eventType).length >= count) return;
    await delay(250);
  }
  throw new Error(`Webhook Receiver did not receive ${count} ${eventType} events.`);
}

function formatLocalDateTime(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}

function readHeader(value) {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function assertNoSecretMaterial(value, label) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    'secretCiphertext',
    'secretKeyVersion',
    'requestBody',
    'request_body',
    'payload',
    'payloadJson',
    'payload_json',
    'WEBHOOK_SECRET_ENCRYPTION_KEY',
    'privateBucket',
    'objectKey',
  ]) {
    if (serialized.includes(forbidden)) {
      throw new Error(`${label} exposes forbidden field ${forbidden}.`);
    }
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
