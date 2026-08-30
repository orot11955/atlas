from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    content = target.read_text(encoding='utf-8')

    if new in content:
        return

    count = content.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one replacement target, found {count}')

    target.write_text(content.replace(old, new, 1), encoding='utf-8')


replace_once(
    'scripts/ci/admin-auth-e2e.mjs',
    "import { createHmac } from 'node:crypto';\n",
    "import { createHmac } from 'node:crypto';\n\n"
    "import { verifyApiClientLifecycle } from './api-client-lifecycle-e2e.mjs';\n",
)

replace_once(
    'scripts/ci/admin-auth-e2e.mjs',
    "mainBlog = (await transitionSite(mainBlog, 'activate', 'active', session)).data;\n"
    "mainBlog = (await transitionSite(mainBlog, 'maintenance', 'maintenance', session)).data;",
    "mainBlog = (await transitionSite(mainBlog, 'activate', 'active', session)).data;\n\n"
    "await verifyApiClientLifecycle({\n"
    "  request,\n"
    "  session,\n"
    "  mainBlog,\n"
    "  devLog: devLogCreated.data,\n"
    "  transitionSite,\n"
    "  assertEqual,\n"
    "});\n\n"
    "mainBlog = (await transitionSite(mainBlog, 'maintenance', 'maintenance', session)).data;",
)

replace_once(
    'scripts/ci/admin-auth-e2e.mjs',
    "process.stdout.write('Admin Password, TOTP, Session, Workspace and Site E2E passed.\\n');",
    "process.stdout.write(\n"
    "  'Admin Password, TOTP, Session, Workspace, Site and API Client E2E passed.\\n',\n"
    ");",
)

replace_once(
    'scripts/ci/admin-auth-e2e.mjs',
    "async function request(path, { method = 'GET', body, expectedStatus, cookieHeader, csrfToken }) {",
    "async function request(\n"
    "  path,\n"
    "  {\n"
    "    method = 'GET',\n"
    "    body,\n"
    "    expectedStatus,\n"
    "    cookieHeader,\n"
    "    csrfToken,\n"
    "    authorization,\n"
    "    origin,\n"
    "  },\n"
    ") {",
)

replace_once(
    'scripts/ci/admin-auth-e2e.mjs',
    "  if (csrfToken) {\n"
    "    headers.set('x-csrf-token', csrfToken);\n"
    "  }\n\n"
    "  const response = await fetch(`${baseUrl}${path}`, {",
    "  if (csrfToken) {\n"
    "    headers.set('x-csrf-token', csrfToken);\n"
    "  }\n"
    "  if (authorization) {\n"
    "    headers.set('authorization', authorization);\n"
    "  }\n"
    "  if (origin) {\n"
    "    headers.set('origin', origin);\n"
    "  }\n\n"
    "  const response = await fetch(`${baseUrl}${path}`, {",
)

replace_once(
    'packages/server/src/api-client.test.ts',
    "  assert.equal(issuer.matches(`${issued.apiKey.slice(0, -1)}A`, issued.secretDigest), false);",
    "  const replacement = issued.apiKey.endsWith('A') ? 'B' : 'A';\n"
    "  const tamperedApiKey = `${issued.apiKey.slice(0, -1)}${replacement}`;\n"
    "  assert.equal(issuer.matches(tamperedApiKey, issued.secretDigest), false);",
)

manager = ROOT / 'apps/admin-web/src/features/api-clients/api-client-manager.tsx'
manager_content = manager.read_text(encoding='utf-8')
manager_content = manager_content.replace('  buildApiClientListPath,\n', '')
manager_content = manager_content.replace(
    "      <small className={styles.muted} aria-hidden=\"true\">\n"
    "        {buildApiClientListPath({ search, status: filterStatus || undefined })}\n"
    "      </small>\n",
    '',
)
manager.write_text(manager_content, encoding='utf-8')

service = ROOT / (
    'packages/server/src/modules/api-client/application/'
    'api-client-administration.service.ts'
)
service_content = service.read_text(encoding='utf-8')
untyped_current = '      const current = await this.repository.findById('
typed_current = (
    '      const current: ApiClientRecord | undefined =\n'
    '        await this.repository.findById('
)
if untyped_current in service_content:
    count = service_content.count(untyped_current)
    if count != 4:
        raise RuntimeError(
            'api-client-administration.service.ts: expected four current-client lookups, '
            f'found {count}'
        )
    service_content = service_content.replace(untyped_current, typed_current)
service.write_text(service_content, encoding='utf-8')

replace_once(
    'apps/api/src/api-clients/api-client.module.ts',
    "      ) =>\n"
    "        new ApiClientAuthenticationService(\n"
    "          repository,\n"
    "          keyIssuer,\n"
    "          rateLimiter,\n"
    "          config.get('API_KEY_USAGE_TOUCH_SECONDS', { infer: true }) * 1_000,\n"
    "        ),",
    "      ): ApiClientAuthenticationService<EntityManager> => {\n"
    "        const usageTouchSeconds: unknown = config.get(\n"
    "          'API_KEY_USAGE_TOUCH_SECONDS',\n"
    "          { infer: true },\n"
    "        );\n\n"
    "        if (typeof usageTouchSeconds !== 'number') {\n"
    "          throw new TypeError('API_KEY_USAGE_TOUCH_SECONDS must be a number.');\n"
    "        }\n\n"
    "        return new ApiClientAuthenticationService(\n"
    "          repository,\n"
    "          keyIssuer,\n"
    "          rateLimiter,\n"
    "          usageTouchSeconds * 1_000,\n"
    "        );\n"
    "      },",
)

required = [
    ROOT / 'scripts/ci/api-client-lifecycle-e2e.mjs',
    ROOT / 'scripts/ci/admin-auth-e2e.mjs',
    ROOT / 'apps/admin-web/src/features/api-clients/api-client-manager.tsx',
    ROOT / 'packages/server/src/modules/api-client/application/api-client-administration.service.ts',
    ROOT / 'apps/api/src/api-clients/api-client.module.ts',
]
missing = [str(path.relative_to(ROOT)) for path in required if not path.is_file()]
if missing:
    raise RuntimeError(f'Required API Client E2E files are missing: {missing}')
