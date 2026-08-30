export async function verifyResourceMemberDirectory({
  request,
  session,
  mainBlog,
  devLog,
  assertEqual,
}) {
  const projects = await request('/admin/v1/projects', {
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
  });
  const project = projects.data[0];

  if (!project?.id) {
    throw new Error('Resource E2E requires the Project created by Phase 4 E2E.');
  }

  await request('/admin/v1/resource-collections', {
    method: 'POST',
    body: { name: 'Architecture' },
    expectedStatus: 403,
    cookieHeader: session.cookieHeader,
  });

  const collectionResponse = await request('/admin/v1/resource-collections', {
    method: 'POST',
    body: { name: 'Architecture', description: 'Architecture notes and references' },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  const collection = collectionResponse.data;
  assertEqual(collection.version, 1, 'Resource Collection version');

  await request('/admin/v1/resources', {
    method: 'POST',
    body: {
      collectionId: collection.id,
      type: 'document',
      title: 'Credential leak attempt',
      bodyMarkdown: 'api_key=atlas_live_123456789012345678901234',
      visibility: 'private',
      sensitivity: 'sensitive',
    },
    expectedStatus: 400,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });

  const resourceResponse = await request('/admin/v1/resources', {
    method: 'POST',
    body: {
      collectionId: collection.id,
      type: 'document',
      title: 'Atlas Architecture',
      summary: 'Resource and Member Directory implementation notes',
      bodyMarkdown: '# Atlas\n\nStore credentials outside this Resource.',
      visibility: 'private',
      sensitivity: 'sensitive',
      secretReference: 'secret://atlas/ci/integration-key',
      tags: ['NestJS', 'Architecture'],
      projectIds: [project.id],
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  let resource = resourceResponse.data;
  assertEqual(resource.tags.includes('nestjs'), true, 'Normalized Resource tag');
  assertEqual(resource.projectIds[0], project.id, 'Resource Project relation');

  const filteredResources = await request(
    `/admin/v1/resources?tag=nestjs&projectId=${encodeURIComponent(project.id)}`,
    {
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
    },
  );
  assertEqual(filteredResources.data.length, 1, 'Filtered Resource count');

  resource = (
    await request(`/admin/v1/resources/${resource.id}`, {
      method: 'PATCH',
      body: {
        version: resource.version,
        collectionId: collection.id,
        type: resource.type,
        title: 'Atlas Architecture Updated',
        summary: resource.summary,
        bodyMarkdown: resource.bodyMarkdown,
        visibility: resource.visibility,
        sensitivity: resource.sensitivity,
        secretReference: resource.secretReference,
        tags: resource.tags,
        projectIds: resource.projectIds,
      },
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    })
  ).data;
  assertEqual(resource.version, 2, 'Updated Resource version');

  resource = (
    await request(`/admin/v1/resources/${resource.id}/archive`, {
      method: 'POST',
      body: { version: resource.version },
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    })
  ).data;
  assertEqual(resource.status, 'archived', 'Archived Resource status');

  const memberResponse = await request('/admin/v1/members', {
    method: 'POST',
    body: {
      email: 'member@atlas.test',
      displayName: 'Atlas Member',
      memberships: [
        { siteId: mainBlog.id, status: 'active' },
        { siteId: devLog.id, status: 'pending' },
      ],
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  let member = memberResponse.data;
  assertEqual(member.memberships.length, 2, 'Member Site Membership count');

  await request('/admin/v1/members', {
    method: 'POST',
    body: {
      email: 'MEMBER@ATLAS.TEST',
      displayName: 'Duplicate Member',
    },
    expectedStatus: 409,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });

  const pendingMembers = await request(
    `/admin/v1/members?siteId=${encodeURIComponent(devLog.id)}&membershipStatus=pending`,
    {
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
    },
  );
  assertEqual(pendingMembers.data.length, 1, 'Pending Site Member count');

  const devMembership = member.memberships.find((membership) => membership.siteId === devLog.id);
  if (!devMembership) throw new Error('Dev Log Membership was not returned.');

  const suspended = await request(`/admin/v1/members/${member.id}/sites/${devLog.id}/status`, {
    method: 'POST',
    body: { version: devMembership.version, status: 'suspended' },
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  assertEqual(suspended.data.status, 'suspended', 'Site Membership status');

  await request(`/admin/v1/members/${member.id}/notes`, {
    method: 'POST',
    body: { body: 'password=super-secret-value' },
    expectedStatus: 400,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });

  await request(`/admin/v1/members/${member.id}/notes`, {
    method: 'POST',
    body: { body: 'Follow up after the first blog invitation.' },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });

  member = (
    await request(`/admin/v1/members/${member.id}`, {
      method: 'PATCH',
      body: {
        version: member.version,
        email: member.email,
        displayName: 'Atlas Member Updated',
      },
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    })
  ).data;
  assertEqual(member.version, 2, 'Updated Member version');

  const memberDetail = await request(`/admin/v1/members/${member.id}`, {
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
  });
  assertEqual(memberDetail.data.notes.length, 1, 'Member Admin Note count');

  member = (
    await request(`/admin/v1/members/${member.id}/archive`, {
      method: 'POST',
      body: { version: member.version },
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    })
  ).data;
  assertEqual(member.status, 'archived', 'Archived Member status');
}
