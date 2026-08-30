export async function verifyContentPublicationDelivery({
  request,
  session,
  mainBlog,
  devLog,
  assertEqual,
}) {
  const contentCreated = await request('/admin/v1/contents', {
    method: 'POST',
    body: {
      type: 'post',
      title: 'Atlas Publication Delivery',
      summary: 'Immutable READY Revision delivery test',
      bodyMarkdown:
        'This is the first immutable Atlas publication body with enough meaningful content.',
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  let content = contentCreated.data;
  assertEqual(content.version, 1, 'Created Content version');
  assertEqual(content.draft.draftVersion, 1, 'Created Content Draft version');

  content = (
    await request(`/admin/v1/contents/${content.id}/ready`, {
      method: 'POST',
      body: {
        contentVersion: content.version,
        draftVersion: content.draft.draftVersion,
        note: 'Initial READY Revision',
      },
      expectedStatus: 201,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    })
  ).data;
  assertEqual(content.readyRevisionNumber, 1, 'Initial READY Revision number');

  const assignment = (
    await request(`/admin/v1/contents/${content.id}/sites`, {
      method: 'POST',
      body: {
        siteId: mainBlog.id,
        slug: 'atlas-publication-delivery',
        visibility: 'public',
        seo: {
          description: 'Atlas Publication Delivery E2E',
          openGraph: { type: 'article' },
        },
      },
      expectedStatus: 201,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    })
  ).data;
  assertEqual(assignment.site.id, mainBlog.id, 'Content Site target');
  assertEqual(assignment.version, 1, 'Content Site version');

  const firstPublish = await request(
    `/admin/v1/contents/${content.id}/sites/${assignment.id}/publish`,
    {
      method: 'POST',
      expectedStatus: 201,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    },
  );
  const firstPublication = firstPublish.data;
  assertEqual(
    firstPublish.response.headers.get('idempotent-replayed'),
    'false',
    'First Publish replay header',
  );
  assertEqual(firstPublication.revisionNumber, 1, 'First Publication Revision');
  assertEqual(firstPublication.status, 'active', 'First Publication status');

  const replayedPublish = await request(
    `/admin/v1/contents/${content.id}/sites/${assignment.id}/publish`,
    {
      method: 'POST',
      expectedStatus: 201,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    },
  );
  assertEqual(
    replayedPublish.response.headers.get('idempotent-replayed'),
    'true',
    'Replayed Publish header',
  );
  assertEqual(replayedPublish.data.id, firstPublication.id, 'Replayed Publication ID');

  const deliveryClientCreated = await request('/admin/v1/api-clients', {
    method: 'POST',
    body: {
      name: 'Publication Delivery E2E',
      description: 'Content publication delivery client',
      type: 'delivery',
      rateLimitPerMinute: 100,
      requireOrigin: false,
      siteIds: [mainBlog.id],
      scopes: ['content:read'],
      allowedOrigins: [],
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  const apiKey = deliveryClientCreated.data.credential.apiKey;
  const authorization = `Bearer ${apiKey}`;

  const list = await request(`/delivery/v1/sites/${mainBlog.key}/posts`, {
    expectedStatus: 200,
    authorization,
  });

  if (!Array.isArray(list.data.items) || list.data.items.length !== 1) {
    throw new Error('Delivery Post list must contain the active public Publication.');
  }
  assertEqual(list.data.items[0]?.publicationId, firstPublication.id, 'Delivery list Publication');

  const firstDetail = await request(`/delivery/v1/sites/${mainBlog.key}/posts/${assignment.slug}`, {
    expectedStatus: 200,
    authorization,
  });
  const firstEtag = firstDetail.response.headers.get('etag');

  if (!firstEtag || !/^"[0-9a-f]{64}"$/u.test(firstEtag)) {
    throw new Error(`Delivery detail ETag is invalid: ${String(firstEtag)}`);
  }
  assertEqual(firstDetail.data.revisionNumber, 1, 'Initial Delivery Revision');

  await request(`/delivery/v1/sites/${mainBlog.key}/posts/${assignment.slug}`, {
    expectedStatus: 304,
    authorization,
    ifNoneMatch: firstEtag,
  });

  await request(`/delivery/v1/sites/${devLog.key}/posts/${assignment.slug}`, {
    expectedStatus: 403,
    authorization,
  });

  content = (
    await request(`/admin/v1/contents/${content.id}/draft`, {
      method: 'PATCH',
      body: {
        draftVersion: content.draft.draftVersion,
        title: 'Atlas Publication Delivery v2',
        summary: 'Second immutable READY Revision',
        bodyMarkdown:
          'This is the second immutable Atlas publication body and it must not appear before republishing.',
      },
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    })
  ).data;

  const beforeRepublish = await request(
    `/delivery/v1/sites/${mainBlog.key}/posts/${assignment.slug}`,
    {
      expectedStatus: 200,
      authorization,
    },
  );
  assertEqual(beforeRepublish.data.revisionNumber, 1, 'Draft must not replace active Publication');
  assertEqual(beforeRepublish.response.headers.get('etag'), firstEtag, 'Draft must preserve ETag');

  content = (
    await request(`/admin/v1/contents/${content.id}/ready`, {
      method: 'POST',
      body: {
        contentVersion: content.version,
        draftVersion: content.draft.draftVersion,
        note: 'Second READY Revision',
      },
      expectedStatus: 201,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    })
  ).data;
  assertEqual(content.readyRevisionNumber, 2, 'Second READY Revision number');

  const secondPublication = (
    await request(`/admin/v1/contents/${content.id}/sites/${assignment.id}/publish`, {
      method: 'POST',
      expectedStatus: 201,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    })
  ).data;
  assertEqual(secondPublication.revisionNumber, 2, 'Second Publication Revision');

  const secondDetail = await request(
    `/delivery/v1/sites/${mainBlog.key}/posts/${assignment.slug}`,
    {
      expectedStatus: 200,
      authorization,
    },
  );
  const secondEtag = secondDetail.response.headers.get('etag');
  assertEqual(secondDetail.data.revisionNumber, 2, 'Republished Delivery Revision');

  if (!secondEtag || secondEtag === firstEtag) {
    throw new Error('Republished Delivery ETag must change.');
  }

  const history = await request(
    `/admin/v1/contents/${content.id}/sites/${assignment.id}/publications`,
    {
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
    },
  );

  if (!Array.isArray(history.data) || history.data.length !== 2) {
    throw new Error('Publication history must contain two immutable Snapshots.');
  }
  assertEqual(
    history.data.filter((publication) => publication.status === 'active').length,
    1,
    'Single active Publication',
  );
  assertEqual(
    history.data.filter((publication) => publication.status === 'superseded').length,
    1,
    'Single superseded Publication',
  );

  await request(`/admin/v1/contents/${content.id}/sites/${assignment.id}/withdraw`, {
    method: 'POST',
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  await request(`/delivery/v1/sites/${mainBlog.key}/posts/${assignment.slug}`, {
    expectedStatus: 404,
    authorization,
  });

  const rollback = await request(
    `/admin/v1/contents/${content.id}/sites/${assignment.id}/publications/${firstPublication.id}/rollback`,
    {
      method: 'POST',
      expectedStatus: 201,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    },
  );
  assertEqual(rollback.data.revisionNumber, 1, 'Rollback Revision');

  if (rollback.data.id === firstPublication.id) {
    throw new Error('Rollback must create a new Publication row.');
  }

  const restoredDetail = await request(
    `/delivery/v1/sites/${mainBlog.key}/posts/${assignment.slug}`,
    {
      expectedStatus: 200,
      authorization,
    },
  );
  assertEqual(restoredDetail.data.revisionNumber, 1, 'Restored Delivery Revision');
  assertEqual(restoredDetail.response.headers.get('etag'), firstEtag, 'Restored Snapshot ETag');
}
