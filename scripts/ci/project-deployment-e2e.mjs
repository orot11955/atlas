export async function verifyProjectDeploymentReadModel({
  request,
  session,
  mainBlog,
  devLog,
  assertEqual,
}) {
  const projectCreated = await request('/admin/v1/projects', {
    method: 'POST',
    body: {
      key: 'atlas-platform',
      name: 'Atlas Platform',
      description: 'Project and Deployment Read Model E2E',
      siteIds: [mainBlog.id],
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  const project = projectCreated.data;
  assertEqual(project.status, 'active', 'Project status');

  const inaccessibleProject = await request('/admin/v1/projects', {
    method: 'POST',
    body: {
      key: 'dev-log-ops',
      name: 'Dev Log Operations',
      siteIds: [devLog.id],
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });

  await request(`/admin/v1/projects/${project.id}/repositories`, {
    method: 'POST',
    body: {
      provider: 'gitea',
      repositoryUrl: 'https://gitea.atlas.test/orot/atlas.git',
      repositoryFullName: 'orot/atlas',
      defaultBranch: 'develop',
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });

  const environmentCreated = await request('/admin/v1/environments', {
    method: 'POST',
    body: {
      key: 'production',
      name: 'Production',
      tier: 'production',
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  const environment = environmentCreated.data;

  const serviceCreated = await request(`/admin/v1/projects/${project.id}/services`, {
    method: 'POST',
    body: {
      key: 'web',
      name: 'Atlas Web',
      type: 'web',
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  const service = serviceCreated.data;

  const targetCreated = await request(
    `/admin/v1/projects/${project.id}/services/${service.id}/environments`,
    {
      method: 'POST',
      body: {
        environmentId: environment.id,
        healthUrl: 'https://atlas.example.test/health',
        healthTimeoutMs: 5000,
      },
      expectedStatus: 201,
      cookieHeader: session.cookieHeader,
      csrfToken: session.csrfToken,
    },
  );
  const target = targetCreated.data;

  const integrationCreated = await request('/admin/v1/api-clients', {
    method: 'POST',
    body: {
      name: 'Project Deployment CI',
      description: 'Project Deployment integration E2E',
      type: 'integration',
      rateLimitPerMinute: 100,
      requireOrigin: false,
      siteIds: [mainBlog.id],
      scopes: ['release:write', 'deployment:create', 'deployment:update', 'health:write'],
      allowedOrigins: [],
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  });
  const apiKey = integrationCreated.data.credential.apiKey;
  const authorization = `Bearer ${apiKey}`;

  await request(`/integration/v1/projects/${inaccessibleProject.data.key}/releases`, {
    method: 'POST',
    body: {
      version: 'v0.0.1',
      commitSha: '0123456789abcdef',
    },
    expectedStatus: 403,
    authorization,
  });

  const releaseCreated = await request(`/integration/v1/projects/${project.key}/releases`, {
    method: 'POST',
    body: {
      version: 'v1.0.0',
      commitSha: '0123456789abcdef0123456789abcdef01234567',
      sourceRef: 'refs/tags/v1.0.0',
      externalId: 'gitea-release-100',
      metadata: { runner: 'github-actions', artifact: 'atlas-web.tar.gz' },
    },
    expectedStatus: 201,
    authorization,
  });
  const release = releaseCreated.data;

  const deploymentInput = {
    serviceKey: service.key,
    environmentKey: environment.key,
    releaseVersion: release.version,
    externalId: 'ci-job-100',
    startedAt: new Date().toISOString(),
    metadata: { workflow: 'deploy', attempt: 1 },
  };

  await request(`/integration/v1/projects/${project.key}/deployments`, {
    method: 'POST',
    body: deploymentInput,
    expectedStatus: 400,
    authorization,
  });

  const firstStart = await request(`/integration/v1/projects/${project.key}/deployments`, {
    method: 'POST',
    body: deploymentInput,
    expectedStatus: 201,
    authorization,
    idempotencyKey: 'atlas-deploy-ci-job-100',
  });
  const deployment = firstStart.data;
  assertEqual(deployment.status, 'running', 'Started Deployment status');
  assertEqual(
    firstStart.response.headers.get('idempotent-replayed'),
    'false',
    'First Deployment replay header',
  );

  const repeatedStart = await request(`/integration/v1/projects/${project.key}/deployments`, {
    method: 'POST',
    body: deploymentInput,
    expectedStatus: 201,
    authorization,
    idempotencyKey: 'atlas-deploy-ci-job-100',
  });
  assertEqual(repeatedStart.data.id, deployment.id, 'Idempotent Deployment ID');
  assertEqual(
    repeatedStart.response.headers.get('idempotent-replayed'),
    'true',
    'Repeated Deployment replay header',
  );

  await request(`/integration/v1/projects/${project.key}/deployments`, {
    method: 'POST',
    body: { ...deploymentInput, externalId: 'ci-job-conflict' },
    expectedStatus: 409,
    authorization,
    idempotencyKey: 'atlas-deploy-ci-job-100',
  });

  await request(`/integration/v1/deployments/${deployment.id}/events`, {
    method: 'POST',
    body: {
      externalEventId: 'ci-job-100-build',
      type: 'build.completed',
      status: 'running',
      message: 'Build and artifact upload completed.',
      metadata: { artifactSha256: 'abc123' },
    },
    expectedStatus: 201,
    authorization,
  });

  const completed = await request(`/integration/v1/deployments/${deployment.id}/complete`, {
    method: 'POST',
    body: {
      status: 'succeeded',
      metadata: { durationSeconds: 42 },
    },
    expectedStatus: 200,
    authorization,
  });
  assertEqual(completed.data.status, 'succeeded', 'Completed Deployment status');

  const unhealthy = await request(`/integration/v1/deployments/${deployment.id}/health`, {
    method: 'POST',
    body: {
      status: 'unhealthy',
      httpStatus: 503,
      latencyMs: 350,
      message: 'Application started but dependency readiness failed.',
    },
    expectedStatus: 201,
    authorization,
  });
  assertEqual(unhealthy.data.status, 'unhealthy', 'Health status');

  const deploymentDetail = await request(`/admin/v1/deployments/${deployment.id}`, {
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
  });
  assertEqual(deploymentDetail.data.deployment.status, 'succeeded', 'Admin Deployment status');
  assertEqual(deploymentDetail.data.latestHealth.status, 'unhealthy', 'Admin Health status');
  assertEqual(
    deploymentDetail.data.serviceEnvironment.currentReleaseId,
    release.id,
    'Current Release after successful Deployment',
  );
  assertEqual(
    deploymentDetail.data.serviceEnvironment.id,
    target.id,
    'Deployment Service Environment',
  );

  const deployments = await request(
    `/admin/v1/deployments?projectId=${encodeURIComponent(project.id)}&limit=100`,
    {
      expectedStatus: 200,
      cookieHeader: session.cookieHeader,
    },
  );
  assertEqual(deployments.data.length, 1, 'Idempotent Deployment row count');

  const projectDetail = await request(`/admin/v1/projects/${project.id}`, {
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
  });
  const eventTypes = new Set(projectDetail.data.timeline.map((event) => event.type));

  for (const expected of [
    'project.created',
    'release.created',
    'deployment.started',
    'deployment.completed',
    'health.checked',
  ]) {
    if (!eventTypes.has(expected)) {
      throw new Error(`Project Timeline is missing ${expected}.`);
    }
  }

  process.stdout.write(
    'Project, Release, idempotent Deployment, Event and independent Health Read Model E2E passed.\n',
  );
}
