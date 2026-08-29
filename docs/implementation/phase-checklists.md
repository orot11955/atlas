# Atlas Phase별 구현 체크리스트

- 문서 상태: Draft v0.1
- 상위 문서: [전체 구현 로드맵](../implementation-roadmap.md)
- 목적: 각 Phase에서 만들어야 할 Schema, Backend, Admin UI, Worker, Test와 완료 조건을 실행 가능한 작업으로 나눈다.

---

## 공통 작업 순서

각 기능은 다음 순서로 진행한다.

```text
1. 사용자 흐름과 상태 전이 확정
2. Entity와 Constraint 설계
3. Migration 작성
4. Domain Policy와 Use Case
5. Repository Port와 TypeORM Adapter
6. Controller 또는 Processor
7. Permission과 Audit
8. Admin UI 또는 Integration Contract
9. Unit / Integration / E2E Test
10. OpenAPI와 문서
```

---

## Phase 0. Repository Foundation

### Repository

- [x] pnpm Workspace
- [x] Turborepo
- [x] Next.js Admin Web
- [x] NestJS API
- [x] NestJS Worker
- [x] 공통 TypeScript 설정
- [x] ESLint와 Prettier
- [x] Frozen Lockfile CI

### Infrastructure

- [x] PostgreSQL
- [x] Redis
- [x] MinIO
- [x] MinIO Bucket Bootstrap
- [x] Nginx
- [x] Dockerfile
- [x] Docker Compose
- [x] Health Check

### 보완

- [ ] `docker compose config` CI
- [ ] Config Schema와 `.env.example` 일치 Test
- [ ] macOS Bootstrap Test
- [ ] Ubuntu Bootstrap Test
- [ ] Integration Test Database 이름과 Cleanup 정책
- [ ] Dependency Update 정책

### 완료 확인

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:migration:run
pnpm check
pnpm dev
```

---

## Phase 1. Server Boundary & Platform Kernel Lite

### Package Boundary

- [ ] `packages/server/package.json`
- [ ] `packages/server/tsconfig.json`
- [ ] `packages/server/src/index.ts`
- [ ] `packages/server/src/core`
- [ ] `packages/server/src/modules`
- [ ] API에서 `@atlas/server` Reference
- [ ] Worker에서 `@atlas/server` Reference
- [ ] `apps/api`의 Domain 코드 생성 금지 규칙 문서화
- [ ] DataSource Entity Glob 변경
- [ ] Turbo Build Dependency 확인

### Request Context

- [ ] `AsyncLocalStorage` Store
- [ ] `requestId`
- [ ] `traceId`
- [ ] `actorType`
- [ ] `actorId`
- [ ] `workspaceId`
- [ ] `siteId`
- [ ] HTTP Middleware
- [ ] Worker Job Context Adapter
- [ ] Context 누락 시 안전한 기본값

### Error Contract

- [ ] `DomainError`
- [ ] `ApplicationError`
- [ ] Error Code Registry
- [ ] HTTP Status Mapping
- [ ] `application/problem+json`
- [ ] Validation Error Field Mapping
- [ ] Unknown Error Redaction
- [ ] `requestId` 포함

### Core Utility

- [ ] UUIDv7 Generator Port
- [ ] System Clock Port
- [ ] Test Clock
- [ ] Transaction Runner
- [ ] Transaction Context 전달
- [ ] 기본 Actor Type

### Audit Foundation

- [ ] `audit_logs` Migration
- [ ] `AuditLogEntity`
- [ ] `AuditRepositoryPort`
- [ ] `AuditService`
- [ ] Security·관리 명령만 기록
- [ ] Metadata Redaction
- [ ] 본문 전체 저장 금지
- [ ] 조회 API는 후속 Phase로 보류

### Logging

- [ ] Pino
- [ ] Request 시작·완료
- [ ] Latency
- [ ] Error Code
- [ ] Context Field
- [ ] Password·Token·Cookie Redaction
- [ ] MinIO Credential Redaction

### Admin Web Foundation

- [ ] API Fetcher
- [ ] Problem Details Parser
- [ ] Request ID 표시
- [ ] Error Boundary
- [ ] Toast
- [ ] Form Error Mapper
- [ ] Loading·Empty·Error Primitive

### Test

- [ ] API와 Worker가 `packages/server` Build
- [ ] Request Context 격리
- [ ] Domain Error Mapping
- [ ] Validation Error Mapping
- [ ] Transaction Rollback
- [ ] Audit Redaction
- [ ] Unknown Error에서 Stack 미노출

### 완료 조건

```text
샘플 Command
→ Transaction
→ 데이터 변경
→ Audit 기록
→ 공통 응답
```

---

## Phase 2. Admin Identity & Shell

### Entity

- [ ] `admin_accounts`
- [ ] `admin_sessions`
- [ ] `admin_mfa_methods`
- [ ] `admin_recovery_codes`
- [ ] `login_attempts`
- [ ] `reauth_tokens`

### Constraint와 Index

- [ ] Admin Email Unique
- [ ] Session Token Digest Unique
- [ ] Recovery Code Digest Unique
- [ ] Revoked·Expired Session Index
- [ ] Login Attempt 조회 Index

### OWNER Bootstrap

- [ ] Interactive CLI
- [ ] Email 입력
- [ ] Password Hidden Input
- [ ] Password 확인
- [ ] Argon2id Hash
- [ ] 기본 Workspace와 OWNER 연결 준비
- [ ] 중복 OWNER Bootstrap 차단
- [ ] 실행 Audit 또는 Bootstrap Log

### Authentication API

```http
POST /api/admin/v1/auth/login
POST /api/admin/v1/auth/mfa/verify
POST /api/admin/v1/auth/recovery
POST /api/admin/v1/auth/logout
GET  /api/admin/v1/auth/session
GET  /api/admin/v1/auth/sessions
DELETE /api/admin/v1/auth/sessions/{sessionId}
POST /api/admin/v1/auth/reauth
POST /api/admin/v1/auth/password/change
```

### Session

- [ ] Cryptographically Secure Token
- [ ] Token Digest 저장
- [ ] Host-only Cookie
- [ ] `HttpOnly`
- [ ] `Secure` Production
- [ ] `SameSite=Strict`
- [ ] Idle Timeout
- [ ] Absolute Timeout
- [ ] Last Seen Throttle Update
- [ ] Logout Revocation
- [ ] 다른 Session 강제 종료

### MFA

- [ ] TOTP Secret 생성
- [ ] Secret 암호화 저장
- [ ] QR Provisioning URI
- [ ] Verify Window 제한
- [ ] Recovery Code 1회 사용
- [ ] MFA 재등록 Reauthentication

### Authorization

- [ ] Role Enum
- [ ] Permission Registry
- [ ] `@RequirePermissions()`
- [ ] Permission Guard
- [ ] OWNER 정책 명시
- [ ] UI Action Visibility

### Admin Web

```text
/auth/login
/auth/mfa
/auth/recovery
/admin/dashboard
/admin/system/sessions
/admin/system/security
```

- [ ] Login Form
- [ ] MFA Form
- [ ] Recovery Form
- [ ] Protected Layout
- [ ] Sidebar
- [ ] Topbar
- [ ] Current Admin Menu
- [ ] Session List
- [ ] Logout

### Security Gate A

- [ ] TLS 환경 설정
- [ ] CSRF Synchronizer Token
- [ ] Login Rate Limit
- [ ] Account Lock 기준
- [ ] Basic CSP
- [ ] X-Content-Type-Options
- [ ] Referrer-Policy
- [ ] Admin Domain Cookie Scope

### Test

- [ ] Password 성공·실패
- [ ] MFA Required
- [ ] Recovery Code 1회 사용
- [ ] Session Idle Expire
- [ ] Session Absolute Expire
- [ ] CSRF 거부
- [ ] Rate Limit
- [ ] Permission 401·403
- [ ] 외부 Site Domain Cookie 미전송

---

## Phase 3. Workspace, Site & API Client

### Workspace

- [ ] `workspaces`
- [ ] 기본 Workspace Bootstrap
- [ ] Key, Name, Timezone, Locale
- [ ] Workspace Context Resolver
- [ ] 다중 Workspace UI는 보류

### Site

- [ ] `sites`
- [ ] `site_domains`
- [ ] `site_settings`
- [ ] `site_secret_references`
- [ ] `UNIQUE(workspace_id, key)`
- [ ] Canonical Domain Partial Unique
- [ ] Site 상태 전이 Policy
- [ ] Archived 수정 정책

### Site API

```http
GET    /api/admin/v1/sites
POST   /api/admin/v1/sites
GET    /api/admin/v1/sites/{siteId}
PATCH  /api/admin/v1/sites/{siteId}
POST   /api/admin/v1/sites/{siteId}/activate
POST   /api/admin/v1/sites/{siteId}/maintenance
POST   /api/admin/v1/sites/{siteId}/disable
POST   /api/admin/v1/sites/{siteId}/archive
GET    /api/admin/v1/sites/{siteId}/domains
POST   /api/admin/v1/sites/{siteId}/domains
PATCH  /api/admin/v1/sites/{siteId}/settings/{key}
```

### API Client Entity

- [ ] `api_clients`
- [ ] `api_client_keys`
- [ ] `api_client_scopes`
- [ ] `api_client_site_access`
- [ ] `api_client_usage`

### API Key

- [ ] 32바이트 이상 Random Secret
- [ ] `atlas_live_{keyId}.{secret}`
- [ ] HMAC-SHA-256 Digest
- [ ] Prefix 조회
- [ ] Constant-time Compare
- [ ] Secret 1회 표시
- [ ] Expiration
- [ ] Rotation Grace Period
- [ ] Revocation
- [ ] Last Used Throttle Update
- [ ] Rate Limit

### Admin Web

```text
/admin/sites
/admin/sites/new
/admin/sites/[siteId]
/admin/sites/[siteId]/domains
/admin/sites/[siteId]/settings
/admin/sites/[siteId]/api-clients
```

- [ ] Site List
- [ ] Site Create Form
- [ ] Site Detail Tabs
- [ ] Domain Form
- [ ] Setting Form
- [ ] Site Switcher
- [ ] API Key 발급 Modal
- [ ] Secret 복사 경고
- [ ] Rotate·Revoke

### Test

- [ ] Workspace Scope
- [ ] Site Key 중복
- [ ] Canonical Domain 하나
- [ ] Site 상태 전이
- [ ] API Key 원문 미저장
- [ ] Site A Key로 Site B 접근 거부
- [ ] 만료·폐기 Key 거부

---

## Phase 4. Project & Deployment Read Model

### Project Entity

- [ ] `projects`
- [ ] `project_events`
- [ ] `repository_connections`
- [ ] `releases`
- [ ] `project_links`
- [ ] Project Status Policy

### Operation Entity

- [ ] `environments`
- [ ] `services`
- [ ] `service_environments`
- [ ] `deployments`
- [ ] `deployment_events`
- [ ] `health_checks`
- [ ] `idempotency_records`

### Project API

```http
GET    /api/admin/v1/projects
POST   /api/admin/v1/projects
GET    /api/admin/v1/projects/{projectId}
PATCH  /api/admin/v1/projects/{projectId}
GET    /api/admin/v1/projects/{projectId}/events
POST   /api/admin/v1/projects/{projectId}/events
GET    /api/admin/v1/projects/{projectId}/releases
POST   /api/admin/v1/projects/{projectId}/repositories
```

### Integration API

```http
POST /api/integration/v1/releases
POST /api/integration/v1/deployments
POST /api/integration/v1/deployments/{deploymentId}/events
POST /api/integration/v1/deployments/{deploymentId}/complete
POST /api/integration/v1/health-check-results
```

### 규칙

- [ ] CI Scope 분리
- [ ] `Idempotency-Key`
- [ ] Request Hash 불일치 시 Conflict
- [ ] Deployment와 Health 상태 분리
- [ ] Event Sequence 단조 증가
- [ ] 현재 Release Projection
- [ ] Callback은 임의 Health URL을 받지 않음
- [ ] 등록된 ServiceEnvironment Health URL만 사용
- [ ] 이 Phase에서는 Workflow Trigger 없음

### Admin Web

```text
/admin/projects
/admin/projects/new
/admin/projects/[projectId]
/admin/projects/[projectId]/timeline
/admin/projects/[projectId]/repositories
/admin/projects/[projectId]/releases
/admin/operations/deployments
/admin/operations/deployments/[deploymentId]
/admin/operations/services
/admin/operations/environments
```

### Test

- [ ] Callback Idempotency
- [ ] Event 순서
- [ ] CI Scope 부족
- [ ] 다른 Workspace Project 접근 차단
- [ ] Deployment 성공 + Health 실패 표시
- [ ] 임의 URL 입력 거부

---

## Phase 5. Resource & Member Directory MVP

### Resource Entity

- [ ] `resource_collections`
- [ ] `resources`
- [ ] `resource_tags`
- [ ] `resource_tag_assignments`
- [ ] `resource_relations`
- [ ] `resource_assets`

### Resource 기능

- [ ] Collection Tree
- [ ] Markdown Body
- [ ] External URL
- [ ] Tag
- [ ] Archive
- [ ] Visibility
- [ ] Sensitivity
- [ ] Project Relation
- [ ] Content Relation 준비
- [ ] Secret Pattern Warning
- [ ] Secret Store Reference Field

### Member Directory Entity

- [ ] `members`
- [ ] `site_memberships`
- [ ] `member_admin_notes`

### Member Directory 기능

- [ ] Member 수동 등록
- [ ] CSV Import는 후속
- [ ] 전체 목록
- [ ] Site Filter
- [ ] 상세
- [ ] Membership 생성
- [ ] 상태 변경
- [ ] 관리자 메모
- [ ] Global Status와 Site Status 구분

### Admin Web

```text
/admin/resources
/admin/resources/new
/admin/resources/[resourceId]
/admin/resource-collections/[collectionId]
/admin/members
/admin/members/[memberId]
```

### Data Gate B

- [ ] PostgreSQL Backup Job
- [ ] Restore Test 기록
- [ ] MinIO Mirror 대상 확정
- [ ] Backup Credential 분리
- [ ] Resource 삭제 보존 기간
- [ ] Member 삭제·익명화 정책 초안

### Test

- [ ] Collection Cycle 방지
- [ ] Resource Scope
- [ ] Secret Warning
- [ ] Site별 Membership 상태 독립
- [ ] Member 상세 개인정보 Audit 범위

---

## Phase 6. Content Draft & Revision

### Entity

- [ ] `contents`
- [ ] `content_drafts`
- [ ] `content_revisions`
- [ ] `content_relations`

### Constraint

- [ ] `content_drafts.content_id` PK/FK
- [ ] `UNIQUE(content_id, revision_number)`
- [ ] `UNIQUE(content_id, content_hash)` 정책 검토
- [ ] Draft Version
- [ ] Revision Immutable Repository

### API

```http
GET    /api/admin/v1/contents
POST   /api/admin/v1/contents
GET    /api/admin/v1/contents/{contentId}
PATCH  /api/admin/v1/contents/{contentId}/draft
POST   /api/admin/v1/contents/{contentId}/revisions
GET    /api/admin/v1/contents/{contentId}/revisions
GET    /api/admin/v1/contents/{contentId}/revisions/{revisionId}
POST   /api/admin/v1/contents/{contentId}/revisions/{revisionId}/restore
POST   /api/admin/v1/contents/{contentId}/ready
POST   /api/admin/v1/contents/{contentId}/draft-state
POST   /api/admin/v1/contents/{contentId}/archive
GET    /api/admin/v1/contents/{contentId}/validation
```

### Editor

- [ ] Title
- [ ] Summary
- [ ] Markdown Source
- [ ] Server Preview
- [ ] Autosave Debounce
- [ ] Save Indicator
- [ ] Optimistic Lock Conflict
- [ ] Local Draft Recovery
- [ ] Revision Checkpoint
- [ ] Revision History
- [ ] Restore

### 규칙

- [ ] Autosave는 Draft만 Update
- [ ] READY에서 Revision 생성
- [ ] Restore는 Draft 복사
- [ ] Revision 직접 Update 금지
- [ ] Markdown Sanitization
- [ ] HTML·MDX Allowlist 초안

### Test

- [ ] Autosave Version Conflict
- [ ] Autosave가 Revision을 생성하지 않음
- [ ] READY Revision 생성
- [ ] Revision Immutable
- [ ] Restore 후 새 Revision
- [ ] Sanitization

---

## Phase 7. Publication & Delivery API

### Entity

- [ ] `content_sites`
- [ ] `content_publications`
- [ ] `publication_attempts`

### Constraint

- [ ] `UNIQUE(content_id, site_id)`
- [ ] `UNIQUE(site_id, route)`
- [ ] ACTIVE Partial Unique
- [ ] Publication Number Unique
- [ ] Publication Snapshot Immutable

### Admin API

```http
GET    /api/admin/v1/contents/{contentId}/sites
POST   /api/admin/v1/contents/{contentId}/sites
PATCH  /api/admin/v1/content-sites/{contentSiteId}
DELETE /api/admin/v1/content-sites/{contentSiteId}
GET    /api/admin/v1/content-sites/{contentSiteId}/validation
POST   /api/admin/v1/content-sites/{contentSiteId}/publish
POST   /api/admin/v1/content-sites/{contentSiteId}/withdraw
GET    /api/admin/v1/content-sites/{contentSiteId}/publications
POST   /api/admin/v1/publications/{publicationId}/restore
```

### Delivery API

```http
GET /api/delivery/v1/sites/{siteKey}
GET /api/delivery/v1/sites/{siteKey}/posts
GET /api/delivery/v1/sites/{siteKey}/posts/{slug}
```

### Publication 규칙

- [ ] READY Revision만 게시
- [ ] Site ACTIVE 확인
- [ ] Route 충돌 확인
- [ ] Snapshot 생성
- [ ] 기존 ACTIVE를 SUPERSEDED
- [ ] 새 ACTIVE 생성
- [ ] Idempotency
- [ ] Audit
- [ ] ETag
- [ ] `If-None-Match`
- [ ] Cache-Control
- [ ] Withdraw Not Found 정책

### Admin Web

```text
/admin/contents/[contentId]/sites
/admin/content-sites/[contentSiteId]
/admin/content-sites/[contentSiteId]/publications
```

### Public Delivery Gate C

- [ ] Site Access Guard
- [ ] Scope Guard
- [ ] Rate Limit
- [ ] API Key Rotation Test
- [ ] Internal Field Leak Test
- [ ] Cache Header Test

### E2E

```text
Draft
→ Revision
→ READY
→ Site Assignment
→ Publish
→ Delivery 조회
→ Draft 수정
→ 기존 Delivery 유지
→ Republish
→ 새 ETag
```

---

## Phase 8. MinIO Media

### Entity

- [ ] `assets`
- [ ] `asset_variants`
- [ ] `asset_usages`
- [ ] `upload_sessions`
- [ ] `asset_processing_attempts`

### Upload

- [ ] Presigned Single PUT
- [ ] Multipart Upload
- [ ] CORS
- [ ] MIME Allowlist
- [ ] Size Limit
- [ ] Checksum
- [ ] Actual Decode
- [ ] Safe Object Key
- [ ] Expiration
- [ ] Incomplete Multipart Cleanup
- [ ] Duplicate Detection

### Worker

- [ ] `atlas-media` Queue
- [ ] Decode 제한
- [ ] EXIF 제거
- [ ] 320 WebP
- [ ] 768 WebP
- [ ] 1280 WebP
- [ ] 1920 AVIF
- [ ] Retry
- [ ] Quarantine
- [ ] Processing Cleanup

### Security

- [ ] Root Credential Bootstrap 전용
- [ ] API Service Account
- [ ] Worker Service Account
- [ ] Public GetObject만 허용
- [ ] ListBucket 차단
- [ ] Nginx GET·HEAD만 허용
- [ ] MinIO API 직접 외부 노출 금지
- [ ] SVG·HTML 기본 차단

### Content 연동

- [ ] `asset://` Parser
- [ ] Asset Picker
- [ ] Cover Asset
- [ ] Alt Text
- [ ] Caption
- [ ] Publication Manifest
- [ ] READY Asset만 게시
- [ ] 사용 중 삭제 차단

### Test

- [ ] Presign Host 일치
- [ ] Checksum 실패
- [ ] MIME 위조
- [ ] Private 원본 접근 차단
- [ ] Public Variant 조회
- [ ] 사용 중 삭제 차단

---

## Phase 9. Outbox, Webhook & Scheduling

### Entity

- [ ] `outbox_events`
- [ ] `event_consumptions`
- [ ] `webhook_endpoints`
- [ ] `webhook_deliveries`
- [ ] `publication_schedules`

### Outbox Relay

- [ ] `FOR UPDATE SKIP LOCKED`
- [ ] Claim Timeout
- [ ] Stale Claim Recovery
- [ ] BullMQ `jobId = eventId`
- [ ] `dispatched_at`
- [ ] Retry Backoff
- [ ] Dead State
- [ ] Manual Retry

### Consumer

- [ ] Consumer Key
- [ ] Event Receipt Unique
- [ ] Running·Success·Failed
- [ ] Idempotent External Call
- [ ] Result Summary

### Webhook

- [ ] HMAC SHA-256
- [ ] Timestamp
- [ ] Event ID
- [ ] Site별 Event
- [ ] Timeout
- [ ] Response Size 제한
- [ ] Retry
- [ ] Disable Policy
- [ ] Manual Redelivery

### Scheduler

- [ ] PublicationSchedule CRUD
- [ ] Site Timezone Input
- [ ] UTC Storage
- [ ] Due Scanner
- [ ] Conditional Claim
- [ ] 실행 직전 재검증
- [ ] Cancel
- [ ] Failed Retry

### Test

- [ ] Relay Crash
- [ ] 중복 Job
- [ ] Consumer 중복 방지
- [ ] Webhook Signature
- [ ] Webhook Retry
- [ ] 예약 중복 실행 방지

---

## Phase 10. Content Operations

### Taxonomy

- [ ] `taxonomy_terms`
- [ ] `content_site_terms`
- [ ] Category
- [ ] Tag
- [ ] Hierarchy
- [ ] Site Scope

### URL

- [ ] `content_redirects`
- [ ] Slug History
- [ ] 301
- [ ] 302
- [ ] 410
- [ ] Broken Link

### Site Composition

- [ ] `site_navigation_items`
- [ ] `home_sections`
- [ ] `featured_contents`
- [ ] Banner
- [ ] SEO Merge

### Delivery

- [ ] Home
- [ ] Page
- [ ] Category List
- [ ] Tag List
- [ ] Archive
- [ ] RSS
- [ ] JSON Feed
- [ ] Sitemap
- [ ] Search
- [ ] OpenGraph
- [ ] JSON-LD

### Editor

- [ ] Split Preview
- [ ] Outline
- [ ] Link Autocomplete
- [ ] Asset Command
- [ ] Revision Diff
- [ ] Keyboard Shortcut

### Test

- [ ] Taxonomy Site Isolation
- [ ] Redirect Loop
- [ ] Broken Link
- [ ] Feed Validation
- [ ] Sitemap Validation
- [ ] Search Visibility

---

## Phase 11. Deployment Control & Incident

### Entity

- [ ] `deployment_commands`
- [ ] `deployment_locks`
- [ ] `incidents`
- [ ] `incident_events`

### Control

- [ ] Command Registry
- [ ] Target Allowlist
- [ ] Parameter Schema
- [ ] Reason 필수
- [ ] Reauth Token
- [ ] Dry-run
- [ ] Production Lock
- [ ] Workflow Trigger Adapter
- [ ] Timeout
- [ ] Result Callback
- [ ] Audit

### Rollback

- [ ] 이전 성공 Release 선택
- [ ] 환경과 SHA 재표시
- [ ] DB Migration 상태 확인
- [ ] 자동 Down Migration 금지
- [ ] 실행 후 Health Check
- [ ] Incident 연결

### Incident

- [ ] Create
- [ ] Severity
- [ ] Status
- [ ] Timeline
- [ ] Deployment 연결
- [ ] Resource·Runbook 연결
- [ ] Close Summary

### Control Gate E

- [ ] Reauthentication
- [ ] Allowlist
- [ ] Lock
- [ ] Audit
- [ ] Dry-run
- [ ] Rollback Runbook
- [ ] Browser에서 Socket·Shell 접근 없음

---

## Phase 12. Member Authentication & Privacy

### Entity

- [ ] `member_identities`
- [ ] `member_sessions`
- [ ] `member_consents`
- [ ] `email_verification_tokens`
- [ ] `password_reset_tokens`
- [ ] `member_export_jobs`
- [ ] `member_anonymization_jobs`

### Member API

```http
POST /api/member/v1/auth/register
POST /api/member/v1/auth/email/verify
POST /api/member/v1/auth/login
POST /api/member/v1/auth/logout
POST /api/member/v1/auth/password/reset/request
POST /api/member/v1/auth/password/reset/complete
GET  /api/member/v1/me
GET  /api/member/v1/memberships
POST /api/member/v1/withdraw
```

### 규칙

- [ ] Argon2id
- [ ] Email Verification
- [ ] 동일 이메일 검증 후 연결
- [ ] Admin Session과 분리
- [ ] Site별 Membership
- [ ] Global Suspension
- [ ] Consent Version
- [ ] Rate Limit
- [ ] Export
- [ ] Withdraw
- [ ] Anonymization

### Privacy Gate D

- [ ] 최소 수집 필드
- [ ] Consent 문서 Version
- [ ] Retention
- [ ] Export
- [ ] 탈퇴
- [ ] 익명화
- [ ] 회원 정보 조회 Audit

---

## Phase 13. Dashboard & Notification

### Entity

- [ ] `notifications`
- [ ] `notification_reads`
- [ ] 필요 시 `dashboard_snapshots`

### Widget

- [ ] Draft
- [ ] READY
- [ ] Scheduled Publication
- [ ] Webhook Failure
- [ ] Media Failure
- [ ] Deployment Failure
- [ ] Service Down
- [ ] Incident
- [ ] Backup Failure
- [ ] Storage Usage
- [ ] Recent Audit

### Notification

- [ ] Severity
- [ ] Deduplication Key
- [ ] Target Link
- [ ] Read
- [ ] Dismiss
- [ ] Resolve
- [ ] Event Consumer

### UX

- [ ] Quick Action
- [ ] Command Palette
- [ ] Global Search
- [ ] Favorites
- [ ] Site Context 유지

---

## Phase 14. Production Release

### Repository

- [ ] `main` Branch Protection
- [ ] Required CI
- [ ] Direct Push 금지
- [ ] Release PR Template
- [ ] Tag 규칙

### Build

- [ ] Container SHA Tag
- [ ] SBOM
- [ ] Vulnerability Scan
- [ ] Dependency Audit
- [ ] Secret Scan
- [ ] Non-root
- [ ] Read-only Filesystem 검토

### Deployment

- [ ] LAB 자동 배포
- [ ] Production 승인
- [ ] Migration Precheck
- [ ] Backup Precheck
- [ ] Compose Pull·Up
- [ ] Health Check
- [ ] Deployment Record
- [ ] Image Rollback

### Observability

- [ ] Prometheus
- [ ] Loki
- [ ] HTTP Latency
- [ ] Error Rate
- [ ] DB Pool
- [ ] Redis
- [ ] MinIO
- [ ] Queue Depth
- [ ] Outbox Lag
- [ ] Webhook Failure
- [ ] Alert Rule

### Backup와 DR

- [ ] PostgreSQL Backup
- [ ] PostgreSQL Restore Drill
- [ ] MinIO Versioning
- [ ] MinIO Mirror
- [ ] Object Restore Drill
- [ ] Redis 초기화 복구
- [ ] Worker 중단 복구
- [ ] Site Stale Cache 검증
- [ ] DR Runbook

---

## 권장 PR 분할

```text
01 refactor/server-package-boundary
02 feat/request-context-problem-details
03 feat/transaction-audit-foundation
04 feat/admin-owner-bootstrap
05 feat/admin-session-login
06 feat/admin-mfa-reauth
07 feat/admin-shell
08 feat/site-management
09 feat/api-client-management
10 feat/project-management-mvp
11 feat/deployment-callback-read-model
12 feat/resource-library-mvp
13 feat/member-directory-mvp
14 feat/content-draft-autosave
15 feat/content-revision-checkpoint
16 feat/content-site-assignment
17 feat/publication-snapshot
18 feat/delivery-post-api
19 test/publication-delivery-e2e
20 feat/minio-upload-session
21 feat/media-processing-worker
22 feat/outbox-relay
23 feat/site-webhook
24 feat/publication-scheduler
```
