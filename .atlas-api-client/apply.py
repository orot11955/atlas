from __future__ import annotations

import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STAGE = ROOT / '.atlas-api-client'


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding='utf-8')


def write(relative: str, content: str) -> None:
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')


def replace_once(relative: str, old: str, new: str, sentinel: str | None = None) -> None:
    content = read(relative)

    if sentinel and sentinel in content:
        return

    count = content.count(old)
    if count != 1:
        raise RuntimeError(f'{relative}: expected one replacement target, found {count}: {old!r}')

    write(relative, content.replace(old, new, 1))


def write_staged_files() -> None:
    for stage_file in ['files-server.py', 'files-api.py', 'files-web.py', 'files-tests.py']:
        namespace = runpy.run_path(str(STAGE / stage_file))
        files = namespace.get('FILES')

        if not isinstance(files, dict) or not files:
            raise RuntimeError(f'{stage_file}: FILES map is missing or empty.')

        for relative, content in files.items():
            if not isinstance(relative, str) or not isinstance(content, str):
                raise RuntimeError(f'{stage_file}: invalid FILES entry.')
            write(relative, content)


write_staged_files()

replace_once(
    'packages/server/src/modules/index.ts',
    "export * from './identity';\n",
    "export * from './api-client';\nexport * from './identity';\n",
    "export * from './api-client';",
)

replace_once(
    'packages/config/src/index.ts',
    "  AUTH_COOKIE_SECURE: environmentBoolean.default(false),\n",
    """  AUTH_COOKIE_SECURE: environmentBoolean.default(false),
  AUTH_API_KEY_PEPPER: z.string().min(32),
  API_CLIENT_USAGE_TOUCH_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3_600)
    .default(60),
  API_CLIENT_KEY_GRACE_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .max(604_800)
    .default(3_600),
""",
    'AUTH_API_KEY_PEPPER:',
)

replace_once(
    'packages/database/src/data-source.ts',
    '  AdminSessionEntity,\n',
    """  AdminSessionEntity,
  ApiClientEntity,
  ApiClientKeyEntity,
  ApiClientScopeEntity,
""",
    'ApiClientEntity,',
)
replace_once(
    'packages/database/src/data-source.ts',
    '    AdminSessionEntity,\n',
    """    AdminSessionEntity,
    ApiClientEntity,
    ApiClientScopeEntity,
    ApiClientKeyEntity,
""",
    '    ApiClientEntity,',
)

replace_once(
    'apps/api/src/app.module.ts',
    "import { AdminWorkspaceSiteModule } from './admin-sites/admin-workspace-site.module';\n",
    """import { AdminWorkspaceSiteModule } from './admin-sites/admin-workspace-site.module';
import { ApiClientModule } from './api-clients/api-client.module';
""",
    "./api-clients/api-client.module",
)
replace_once(
    'apps/api/src/app.module.ts',
    '    AdminWorkspaceSiteModule,\n    HealthModule,\n',
    '    AdminWorkspaceSiteModule,\n    ApiClientModule,\n    HealthModule,\n',
    '    ApiClientModule,',
)

replace_once(
    '.env.example',
    'AUTH_COOKIE_SECURE=false\n',
    """AUTH_COOKIE_SECURE=false

# Site-scoped Delivery API Clients
# High-entropy API Key Secrets are authenticated with this HMAC Pepper.
AUTH_API_KEY_PEPPER=atlas-api-client-key-local-secret-pepper
API_CLIENT_USAGE_TOUCH_SECONDS=60
API_CLIENT_KEY_GRACE_SECONDS=3600
""",
    'AUTH_API_KEY_PEPPER=',
)

replace_once(
    'compose.yml',
    '      AUTH_COOKIE_SECURE: ${AUTH_COOKIE_SECURE:-false}\n',
    """      AUTH_COOKIE_SECURE: ${AUTH_COOKIE_SECURE:-false}
      AUTH_API_KEY_PEPPER: ${AUTH_API_KEY_PEPPER:-atlas-api-client-key-local-secret-pepper}
      API_CLIENT_USAGE_TOUCH_SECONDS: ${API_CLIENT_USAGE_TOUCH_SECONDS:-60}
      API_CLIENT_KEY_GRACE_SECONDS: ${API_CLIENT_KEY_GRACE_SECONDS:-3600}
""",
    '      AUTH_API_KEY_PEPPER:',
)

replace_once(
    '.github/workflows/ci.yml',
    "      AUTH_COOKIE_SECURE: 'false'\n",
    """      AUTH_COOKIE_SECURE: 'false'
      AUTH_API_KEY_PEPPER: atlas-ci-api-client-key-secret-pepper
      API_CLIENT_USAGE_TOUCH_SECONDS: 1
      API_CLIENT_KEY_GRACE_SECONDS: 60
""",
    '      AUTH_API_KEY_PEPPER:',
)

site_detail = 'apps/admin-web/src/features/sites/site-detail.tsx'
replace_once(
    site_detail,
    """          <Link className={styles.secondaryLink} href=\"/admin/sites\">
            목록으로
          </Link>
          <span className={styles.statusPill} data-status={site.status}>
""",
    """          <Link className={styles.secondaryLink} href=\"/admin/sites\">
            목록으로
          </Link>
          <Link
            className={styles.secondaryLink}
            href={`/admin/sites/${site.id}/api-clients`}
          >
            API Client
          </Link>
          <span className={styles.statusPill} data-status={site.status}>
""",
    'API Client\n          </Link>',
)

controller_path = 'apps/api/src/api-clients/admin-api-client.controller.ts'
controller = read(controller_path)
for marker in [
    "  @Post(':clientId/enable')\n  @UseGuards(...WRITE_GUARDS)",
    "  @Post(':clientId/disable')\n  @UseGuards(...WRITE_GUARDS)",
    "  @Post(':clientId/revoke')\n  @UseGuards(...WRITE_GUARDS)",
]:
    if marker not in controller:
        raise RuntimeError(f'{controller_path}: status endpoint marker missing: {marker}')
    controller = controller.replace(
        marker,
        marker.replace(
            '\n  @UseGuards',
            '\n  @HttpCode(HttpStatus.OK)\n  @UseGuards',
        ),
        1,
    )
write(controller_path, controller)

# Extend the authenticated integration flow with Site API Client issuance, Delivery authentication,
# exact Origin enforcement, rate limiting, Key rotation, Grace Period and revocation.
e2e_path = 'scripts/ci/admin-auth-e2e.mjs'
e2e = read(e2e_path)
insert_marker = 'const totpLogin = await login();\n'
if 'API Client creation response is invalid.' not in e2e:
    if insert_marker not in e2e:
        raise RuntimeError(f'{e2e_path}: API Client E2E insertion marker was not found.')

    api_client_flow = r'''let devLog = (
  await transitionSite(devLogCreated.data, 'activate', 'active', session)
).data;

await request(`/admin/v1/sites/${devLog.id}/api-clients`, {
  method: 'POST',
  body: {
    name: 'CI Delivery Client',
    scopes: ['site:read', 'content:read'],
    allowedOrigins: ['https://dev-log.atlas.test'],
    rateLimitPerMinute: 20,
  },
  expectedStatus: 403,
  cookieHeader: session.cookieHeader,
});

const apiClientCreated = await request(
  `/admin/v1/sites/${devLog.id}/api-clients`,
  {
    method: 'POST',
    body: {
      name: 'CI Delivery Client',
      scopes: ['site:read', 'content:read'],
      allowedOrigins: ['https://dev-log.atlas.test'],
      rateLimitPerMinute: 20,
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  },
);
let deliveryClient = apiClientCreated.data.client;
let deliveryKey = apiClientCreated.data.issuedKey;
assertApiClient(deliveryClient, devLog.id, 'active');

if (
  typeof deliveryKey.token !== 'string' ||
  !deliveryKey.token.startsWith('atlas_live_') ||
  typeof deliveryKey.id !== 'string'
) {
  throw new Error('API Client creation response is invalid.');
}

const listedApiClients = await request(
  `/admin/v1/sites/${devLog.id}/api-clients`,
  {
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
  },
);

if (
  !Array.isArray(listedApiClients.data) ||
  listedApiClients.data.length !== 1 ||
  JSON.stringify(listedApiClients.data).includes(deliveryKey.token) ||
  JSON.stringify(listedApiClients.data).includes('secretDigest')
) {
  throw new Error('API Client list leaked a Secret or returned invalid data.');
}

await request(`/delivery/v1/sites/${devLog.key}`, {
  expectedStatus: 401,
});
await request(`/delivery/v1/sites/${devLog.key}`, {
  expectedStatus: 403,
  authorization: `Bearer ${deliveryKey.token}`,
  origin: 'https://attacker.atlas.test',
});
const deliveredSite = await request(`/delivery/v1/sites/${devLog.key}`, {
  expectedStatus: 200,
  authorization: `Bearer ${deliveryKey.token}`,
  origin: 'https://dev-log.atlas.test',
});
assertEqual(deliveredSite.data.id, devLog.id, 'Delivered Site ID');
await request(`/delivery/v1/sites/${mainBlog.key}`, {
  expectedStatus: 403,
  authorization: `Bearer ${deliveryKey.token}`,
  origin: 'https://dev-log.atlas.test',
});

const rotatedApiClient = await request(
  `/admin/v1/sites/${devLog.id}/api-clients/${deliveryClient.id}/rotate`,
  {
    method: 'POST',
    body: { graceSeconds: 60 },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  },
);
const previousDeliveryKey = deliveryKey;
deliveryClient = rotatedApiClient.data.client;
deliveryKey = rotatedApiClient.data.issuedKey;
assertApiClient(deliveryClient, devLog.id, 'active');

await request(`/delivery/v1/sites/${devLog.key}`, {
  expectedStatus: 200,
  authorization: `Bearer ${previousDeliveryKey.token}`,
  origin: 'https://dev-log.atlas.test',
});
await request(
  `/admin/v1/sites/${devLog.id}/api-clients/${deliveryClient.id}/keys/${previousDeliveryKey.id}/revoke`,
  {
    method: 'POST',
    expectedStatus: 204,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  },
);
await request(`/delivery/v1/sites/${devLog.key}`, {
  expectedStatus: 401,
  authorization: `Bearer ${previousDeliveryKey.token}`,
  origin: 'https://dev-log.atlas.test',
});
await request(`/delivery/v1/sites/${devLog.key}`, {
  expectedStatus: 200,
  authorization: `Bearer ${deliveryKey.token}`,
  origin: 'https://dev-log.atlas.test',
});

const disabledClientResponse = await request(
  `/admin/v1/sites/${devLog.id}/api-clients/${deliveryClient.id}/disable`,
  {
    method: 'POST',
    body: { version: deliveryClient.version },
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  },
);
deliveryClient = disabledClientResponse.data;
await request(`/delivery/v1/sites/${devLog.key}`, {
  expectedStatus: 401,
  authorization: `Bearer ${deliveryKey.token}`,
  origin: 'https://dev-log.atlas.test',
});

const enabledClientResponse = await request(
  `/admin/v1/sites/${devLog.id}/api-clients/${deliveryClient.id}/enable`,
  {
    method: 'POST',
    body: { version: deliveryClient.version },
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  },
);
deliveryClient = enabledClientResponse.data;
await request(`/delivery/v1/sites/${devLog.key}`, {
  expectedStatus: 200,
  authorization: `Bearer ${deliveryKey.token}`,
  origin: 'https://dev-log.atlas.test',
});

const rateLimitedClientResponse = await request(
  `/admin/v1/sites/${devLog.id}/api-clients`,
  {
    method: 'POST',
    body: {
      name: 'CI Rate Limited Client',
      scopes: ['site:read'],
      allowedOrigins: [],
      rateLimitPerMinute: 2,
    },
    expectedStatus: 201,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  },
);
const rateLimitedKey = rateLimitedClientResponse.data.issuedKey.token;
await request(`/delivery/v1/sites/${devLog.key}`, {
  expectedStatus: 200,
  authorization: `Bearer ${rateLimitedKey}`,
});
await request(`/delivery/v1/sites/${devLog.key}`, {
  expectedStatus: 200,
  authorization: `Bearer ${rateLimitedKey}`,
});
await request(`/delivery/v1/sites/${devLog.key}`, {
  expectedStatus: 429,
  authorization: `Bearer ${rateLimitedKey}`,
});

const revokedClientResponse = await request(
  `/admin/v1/sites/${devLog.id}/api-clients/${deliveryClient.id}/revoke`,
  {
    method: 'POST',
    body: { version: deliveryClient.version },
    expectedStatus: 200,
    cookieHeader: session.cookieHeader,
    csrfToken: session.csrfToken,
  },
);
deliveryClient = revokedClientResponse.data;
assertApiClient(deliveryClient, devLog.id, 'revoked');
await request(`/delivery/v1/sites/${devLog.key}`, {
  expectedStatus: 401,
  authorization: `Bearer ${deliveryKey.token}`,
  origin: 'https://dev-log.atlas.test',
});

'''
    e2e = e2e.replace(insert_marker, api_client_flow + insert_marker, 1)

request_old = r'''    expectedStatus,
    cookieHeader,
    csrfToken,
  },
) {
'''
request_new = r'''    expectedStatus,
    cookieHeader,
    csrfToken,
    authorization,
    origin,
  },
) {
'''
if '    authorization,\n    origin,\n' not in e2e:
    if request_old not in e2e:
        raise RuntimeError(f'{e2e_path}: request option marker was not found.')
    e2e = e2e.replace(request_old, request_new, 1)

header_marker = r'''  if (csrfToken) {
    headers.set('x-csrf-token', csrfToken);
  }

  const response = await fetch'''
header_replacement = r'''  if (csrfToken) {
    headers.set('x-csrf-token', csrfToken);
  }
  if (authorization) {
    headers.set('authorization', authorization);
  }
  if (origin) {
    headers.set('origin', origin);
  }

  const response = await fetch'''
if "headers.set('authorization', authorization);" not in e2e:
    if header_marker not in e2e:
        raise RuntimeError(f'{e2e_path}: request Header marker was not found.')
    e2e = e2e.replace(header_marker, header_replacement, 1)

assert_site_marker = 'function assertSite(value, key, status) {\n'
if 'function assertApiClient(value, siteId, status)' not in e2e:
    if assert_site_marker not in e2e:
        raise RuntimeError(f'{e2e_path}: assertSite marker was not found.')
    e2e = e2e.replace(
        assert_site_marker,
        r'''function assertApiClient(value, siteId, status) {
  if (
    !value ||
    typeof value.id !== 'string' ||
    value.siteId !== siteId ||
    value.status !== status ||
    typeof value.version !== 'number' ||
    !Array.isArray(value.scopes) ||
    !Array.isArray(value.keys)
  ) {
    throw new Error(`API Client response is invalid for ${siteId}/${status}.`);
  }
}

''' + assert_site_marker,
        1,
    )
write(e2e_path, e2e)

progress_path = 'docs/implementation/progress.md'
progress = read(progress_path)
if 'Site-scoped API Client와 Key Lifecycle' not in progress:
    progress = progress.replace(
        '## 다음\n\n```text\nSite Scope API Client Schema',
        '''### Site-scoped API Client와 Key Lifecycle

- `api_clients`, `api_client_scopes`, `api_client_keys` Schema
- Site 범위 Client 이름과 Key 상태 관리
- `atlas_live_{keyId}.{secret}` 형식의 고Entropy Key 원문 1회 발급
- HMAC-SHA-256 + Secret Pepper Digest 저장
- `site:read`, `content:read`, `feed:read` Scope
- Exact Allowed Origin 정책과 Server-to-server 예외
- Redis 분당 Rate Limit
- Key 회전과 Grace Period
- Key·Client 폐기와 최근 사용 시각
- Delivery Site Identity 인증 경계
- Site API Client 관리 화면

Admin API:

```text
GET   /api/admin/v1/sites/{siteId}/api-clients
POST  /api/admin/v1/sites/{siteId}/api-clients
GET   /api/admin/v1/sites/{siteId}/api-clients/{clientId}
PATCH /api/admin/v1/sites/{siteId}/api-clients/{clientId}
POST  /api/admin/v1/sites/{siteId}/api-clients/{clientId}/rotate
POST  /api/admin/v1/sites/{siteId}/api-clients/{clientId}/enable
POST  /api/admin/v1/sites/{siteId}/api-clients/{clientId}/disable
POST  /api/admin/v1/sites/{siteId}/api-clients/{clientId}/revoke
POST  /api/admin/v1/sites/{siteId}/api-clients/{clientId}/keys/{keyId}/revoke
```

Delivery API:

```text
GET /api/delivery/v1/sites/{siteKey}
```

## 다음

```text
Content Draft와 Revision Foundation''',
        1,
    )
write(progress_path, progress)

required = [
    'packages/server/src/modules/api-client/application/api-client-authentication.service.ts',
    'packages/server/src/modules/api-client/application/api-client-management.service.ts',
    'packages/server/src/modules/api-client/infrastructure/persistence/typeorm-api-client.repository.ts',
    'packages/database/src/migrations/1788024000000-CreateSiteApiClients.ts',
    'apps/api/src/api-clients/api-client.module.ts',
    'apps/api/src/api-clients/admin-api-client.controller.ts',
    'apps/api/src/api-clients/delivery-site.controller.ts',
    'apps/admin-web/src/features/api-clients/api-client-manager.tsx',
    'apps/admin-web/src/app/admin/sites/[siteId]/api-clients/page.tsx',
]
missing = [relative for relative in required if not (ROOT / relative).is_file()]
if missing:
    raise RuntimeError(f'Missing staged API Client files: {missing}')

print('Site API Client implementation materialized.')
