from __future__ import annotations

import base64
import json
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    content = target.read_text(encoding="utf-8")
    if new in content:
        return
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement target, found {count}")
    target.write_text(content.replace(old, new, 1), encoding="utf-8")


bundle = base64.b64decode((Path(__file__).with_name("bundle.b64")).read_bytes())
FILES = json.loads(zlib.decompress(bundle).decode("utf-8"))

for relative_path, content in FILES.items():
    target = ROOT / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")

replace_once(
    "packages/server/src/modules/index.ts",
    "export * from './identity';\nexport * from './site';",
    "export * from './identity';\nexport * from './project-deployment';\nexport * from './site';",
)

replace_once(
    "packages/server/src/core/errors/error-code.ts",
    "  API_CLIENT_NOT_FOUND: 'API_CLIENT_NOT_FOUND',\n  AUTH_REQUIRED: 'AUTH_REQUIRED',",
    "  API_CLIENT_NOT_FOUND: 'API_CLIENT_NOT_FOUND',\n"
    "  DEPLOYMENT_NOT_FOUND: 'DEPLOYMENT_NOT_FOUND',\n"
    "  ENVIRONMENT_KEY_ALREADY_EXISTS: 'ENVIRONMENT_KEY_ALREADY_EXISTS',\n"
    "  ENVIRONMENT_NOT_FOUND: 'ENVIRONMENT_NOT_FOUND',\n"
    "  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',\n"
    "  PROJECT_KEY_ALREADY_EXISTS: 'PROJECT_KEY_ALREADY_EXISTS',\n"
    "  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',\n"
    "  RELEASE_ALREADY_EXISTS: 'RELEASE_ALREADY_EXISTS',\n"
    "  RELEASE_NOT_FOUND: 'RELEASE_NOT_FOUND',\n"
    "  REPOSITORY_CONNECTION_ALREADY_EXISTS: 'REPOSITORY_CONNECTION_ALREADY_EXISTS',\n"
    "  SERVICE_ENVIRONMENT_ALREADY_EXISTS: 'SERVICE_ENVIRONMENT_ALREADY_EXISTS',\n"
    "  SERVICE_ENVIRONMENT_NOT_FOUND: 'SERVICE_ENVIRONMENT_NOT_FOUND',\n"
    "  SERVICE_KEY_ALREADY_EXISTS: 'SERVICE_KEY_ALREADY_EXISTS',\n"
    "  SERVICE_NOT_FOUND: 'SERVICE_NOT_FOUND',\n"
    "  AUTH_REQUIRED: 'AUTH_REQUIRED',",
)

replace_once(
    "apps/api/src/filters/problem-details.filter.ts",
    "  [ErrorCode.API_CLIENT_NOT_FOUND]: HttpStatus.NOT_FOUND,\n  [ErrorCode.AUTH_REQUIRED]: HttpStatus.UNAUTHORIZED,",
    "  [ErrorCode.API_CLIENT_NOT_FOUND]: HttpStatus.NOT_FOUND,\n"
    "  [ErrorCode.DEPLOYMENT_NOT_FOUND]: HttpStatus.NOT_FOUND,\n"
    "  [ErrorCode.ENVIRONMENT_KEY_ALREADY_EXISTS]: HttpStatus.CONFLICT,\n"
    "  [ErrorCode.ENVIRONMENT_NOT_FOUND]: HttpStatus.NOT_FOUND,\n"
    "  [ErrorCode.IDEMPOTENCY_CONFLICT]: HttpStatus.CONFLICT,\n"
    "  [ErrorCode.PROJECT_KEY_ALREADY_EXISTS]: HttpStatus.CONFLICT,\n"
    "  [ErrorCode.PROJECT_NOT_FOUND]: HttpStatus.NOT_FOUND,\n"
    "  [ErrorCode.RELEASE_ALREADY_EXISTS]: HttpStatus.CONFLICT,\n"
    "  [ErrorCode.RELEASE_NOT_FOUND]: HttpStatus.NOT_FOUND,\n"
    "  [ErrorCode.REPOSITORY_CONNECTION_ALREADY_EXISTS]: HttpStatus.CONFLICT,\n"
    "  [ErrorCode.SERVICE_ENVIRONMENT_ALREADY_EXISTS]: HttpStatus.CONFLICT,\n"
    "  [ErrorCode.SERVICE_ENVIRONMENT_NOT_FOUND]: HttpStatus.NOT_FOUND,\n"
    "  [ErrorCode.SERVICE_KEY_ALREADY_EXISTS]: HttpStatus.CONFLICT,\n"
    "  [ErrorCode.SERVICE_NOT_FOUND]: HttpStatus.NOT_FOUND,\n"
    "  [ErrorCode.AUTH_REQUIRED]: HttpStatus.UNAUTHORIZED,",
)

replace_once(
    "packages/server/src/modules/api-client/domain/api-client.ts",
    "export interface ApiClientPrincipal {\n"
    "  apiClientId: string;\n"
    "  apiClientKeyId: string;\n"
    "  workspaceId: string;\n"
    "  type: ApiClientType;\n"
    "  scopes: readonly ApiClientScope[];\n"
    "  site: Readonly<ApiClientSiteContext>;\n"
    "}",
    "export interface ApiClientPrincipal {\n"
    "  apiClientId: string;\n"
    "  apiClientKeyId: string;\n"
    "  workspaceId: string;\n"
    "  type: ApiClientType;\n"
    "  scopes: readonly ApiClientScope[];\n"
    "  siteIds: readonly string[];\n"
    "  site?: Readonly<ApiClientSiteContext>;\n"
    "}",
)

replace_once(
    "packages/database/src/data-source.ts",
    "  AuditLogEntity,\n  SiteDomainEntity,",
    "  AuditLogEntity,\n"
    "  DeploymentEntity,\n"
    "  DeploymentEventEntity,\n"
    "  EnvironmentEntity,\n"
    "  HealthCheckEntity,\n"
    "  IdempotencyRecordEntity,\n"
    "  ProjectEntity,\n"
    "  ProjectEventEntity,\n"
    "  ProjectSiteEntity,\n"
    "  ReleaseEntity,\n"
    "  RepositoryConnectionEntity,\n"
    "  ServiceEntity,\n"
    "  ServiceEnvironmentEntity,\n"
    "  SiteDomainEntity,",
)

replace_once(
    "packages/database/src/data-source.ts",
    "    ApiClientAllowedOriginEntity,\n    ApiClientKeyEntity,\n  ],",
    "    ApiClientAllowedOriginEntity,\n"
    "    ApiClientKeyEntity,\n"
    "    ProjectEntity,\n"
    "    ProjectSiteEntity,\n"
    "    ProjectEventEntity,\n"
    "    RepositoryConnectionEntity,\n"
    "    ReleaseEntity,\n"
    "    EnvironmentEntity,\n"
    "    ServiceEntity,\n"
    "    ServiceEnvironmentEntity,\n"
    "    DeploymentEntity,\n"
    "    DeploymentEventEntity,\n"
    "    HealthCheckEntity,\n"
    "    IdempotencyRecordEntity,\n"
    "  ],",
)

replace_once(
    "apps/api/src/app.module.ts",
    "import { PlatformModule } from './platform/platform.module';",
    "import { PlatformModule } from './platform/platform.module';\n"
    "import { ProjectDeploymentModule } from './project-deployment/project-deployment.module';",
)

replace_once(
    "apps/api/src/app.module.ts",
    "    ApiClientModule,\n    HealthModule,",
    "    ApiClientModule,\n    ProjectDeploymentModule,\n    HealthModule,",
)

replace_once(
    "apps/admin-web/src/components/admin/admin-navigation.tsx",
    "  { href: '/admin/api-clients', label: 'API Client', exact: false },\n"
    "  { href: '/admin/security/sessions', label: '활성 Session', exact: false },",
    "  { href: '/admin/api-clients', label: 'API Client', exact: false },\n"
    "  { href: '/admin/projects', label: '프로젝트', exact: false },\n"
    "  { href: '/admin/deployments', label: '배포', exact: false },\n"
    "  { href: '/admin/security/sessions', label: '활성 Session', exact: false },",
)

replace_once(
    "apps/admin-web/src/components/admin/admin-navigation.tsx",
    "const plannedItems = ['콘텐츠', '프로젝트', '배포', '자료실', '회원'] as const;",
    "const plannedItems = ['콘텐츠', '자료실', '회원'] as const;",
)

replace_once(
    "scripts/ci/admin-auth-e2e.mjs",
    "import { verifyApiClientLifecycle } from './api-client-lifecycle-e2e.mjs';",
    "import { verifyApiClientLifecycle } from './api-client-lifecycle-e2e.mjs';\n"
    "import { verifyProjectDeploymentReadModel } from './project-deployment-e2e.mjs';",
)

replace_once(
    "scripts/ci/admin-auth-e2e.mjs",
    "await verifyApiClientLifecycle({\n"
    "  request,\n"
    "  session,\n"
    "  mainBlog,\n"
    "  devLog: devLogCreated.data,\n"
    "  transitionSite,\n"
    "  assertEqual,\n"
    "});\n\n"
    "mainBlog = (await transitionSite(mainBlog, 'maintenance', 'maintenance', session)).data;",
    "await verifyApiClientLifecycle({\n"
    "  request,\n"
    "  session,\n"
    "  mainBlog,\n"
    "  devLog: devLogCreated.data,\n"
    "  transitionSite,\n"
    "  assertEqual,\n"
    "});\n\n"
    "await verifyProjectDeploymentReadModel({\n"
    "  request,\n"
    "  session,\n"
    "  mainBlog,\n"
    "  devLog: devLogCreated.data,\n"
    "  assertEqual,\n"
    "});\n\n"
    "mainBlog = (await transitionSite(mainBlog, 'maintenance', 'maintenance', session)).data;",
)

replace_once(
    "scripts/ci/admin-auth-e2e.mjs",
    "process.stdout.write('Admin Password, TOTP, Session, Workspace, Site and API Client E2E passed.\\n');",
    "process.stdout.write(\n"
    "  'Admin Password, TOTP, Session, Workspace, Site, API Client, Project and Deployment E2E passed.\\n',\n"
    ");",
)

replace_once(
    "scripts/ci/admin-auth-e2e.mjs",
    "  { method = 'GET', body, expectedStatus, cookieHeader, csrfToken, authorization, origin },",
    "  {\n"
    "    method = 'GET',\n"
    "    body,\n"
    "    expectedStatus,\n"
    "    cookieHeader,\n"
    "    csrfToken,\n"
    "    authorization,\n"
    "    origin,\n"
    "    idempotencyKey,\n"
    "  },",
)

replace_once(
    "scripts/ci/admin-auth-e2e.mjs",
    "  if (origin) {\n    headers.set('origin', origin);\n  }\n\n"
    "  const response = await fetch(`${baseUrl}${path}`, {",
    "  if (origin) {\n    headers.set('origin', origin);\n  }\n"
    "  if (idempotencyKey) {\n    headers.set('idempotency-key', idempotencyKey);\n  }\n\n"
    "  const response = await fetch(`${baseUrl}${path}`, {",
)

replace_once(
    "docs/implementation/progress.md",
    "## 다음\n\n"
    "### Phase 4. Project & Deployment Read Model\n\n"
    "```text\n"
    "Project Schema와 CRUD\n"
    "→ Project Timeline Event\n"
    "→ Repository Connection과 Release\n"
    "→ Environment와 Service\n"
    "→ Deployment·Deployment Event Read Model\n"
    "→ Health Check Result\n"
    "→ CI Callback API Client Scope 적용\n"
    "→ Project·Deployment Admin 화면\n"
    "→ 배포 성공과 Service Health 상태 분리\n"
    "```",
    "## 완료\n\n"
    "### Phase 4. Project & Deployment Read Model\n\n"
    "- Workspace-scoped Project와 Site 연결\n"
    "- Project Timeline, Repository Connection과 Release\n"
    "- Environment, Service와 Service Environment\n"
    "- 사전 등록 Health URL과 Timeout\n"
    "- Deployment와 Deployment Event Read Model\n"
    "- 배포 상태와 Health 상태의 독립 저장·조회\n"
    "- Integration API Client Scope 기반 CI Callback\n"
    "- PostgreSQL Advisory Lock과 Idempotency Record\n"
    "- Project·Deployment Admin 화면\n"
    "- 실제 PostgreSQL·Redis·NestJS 통합 E2E\n\n"
    "## 다음\n\n"
    "### Phase 5. Content Authoring Core\n\n"
    "```text\n"
    "Post와 Page Schema\n"
    "→ Content Revision\n"
    "→ Draft 저장과 Optimistic Lock\n"
    "→ Category와 Tag\n"
    "→ Preview Token\n"
    "→ Content Admin Editor\n"
    "```",
)

print(f"Applied {len(FILES)} Project and Deployment files.")
