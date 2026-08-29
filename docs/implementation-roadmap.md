# Atlas 전체 구현 로드맵

- 문서 상태: Draft v0.1
- 기준 브랜치: `develop`
- 기준 아키텍처: Next.js Admin Web + NestJS Modular Monolith + NestJS Worker
- 데이터 저장소: PostgreSQL + Redis + MinIO
- 목표: 관리자 패널을 먼저 완성하고, 이후 여러 Site가 Delivery API를 통해 콘텐츠를 제공받도록 구성한다.

---

## 1. 구현 원칙

### 1.1 수평 계층보다 수직 기능을 먼저 완성한다

Entity를 전부 만든 뒤 UI를 한꺼번에 붙이지 않는다. 각 단계는 아래 흐름을 끝까지 완성한다.

```text
Migration
→ Domain / Application
→ Repository Adapter
→ Controller / DTO
→ Permission / Audit
→ Admin UI
→ Test
→ OpenAPI / 문서
```

### 1.2 첫 번째 제품 목표는 텍스트 콘텐츠 게시다

고급 에디터, 이미지 변환, 회원 기능보다 아래 흐름을 먼저 완성한다.

```text
OWNER 로그인
→ Site 생성
→ Delivery API Client 발급
→ Markdown 글 작성
→ Revision 생성
→ Site 배치
→ Publish
→ Delivery API 조회
```

이 흐름이 Atlas의 첫 번째 실질적 MVP다.

### 1.3 공통 기반은 초기에 만든다

다음 기능은 후반에 덧붙이지 않고 초기부터 모든 모듈이 사용하도록 한다.

```text
Request Context
Error Contract
Transaction Boundary
Permission Guard
Audit Log
Idempotency
Optimistic Lock
Transactional Outbox
Structured Logging
```

단, Outbox의 다양한 Consumer와 운영 화면은 필요한 단계에서 점진적으로 추가한다.

### 1.4 Site와 Workspace 경계를 모든 조회에 적용한다

- Workspace 범위 데이터는 모든 Query에서 `workspaceId`를 제한한다.
- Site 범위 데이터는 `workspaceId + siteId`를 제한한다.
- 관리자 요청에서 Client가 보낸 Workspace ID를 그대로 신뢰하지 않는다.
- Delivery API는 API Client의 Site Access와 요청 `siteKey`가 일치하는지 검사한다.
- Repository Port에 Scope가 빠진 범용 `findAll()`을 만들지 않는다.

### 1.5 배포 가능한 단위를 유지한다

각 Phase가 끝날 때 다음 조건을 만족해야 한다.

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Migration 적용과 이전 버전 애플리케이션 호환성도 확인한다.

---

## 2. 전체 순서

| Phase | 이름                           | 상태 | 핵심 결과                                      |
| ----: | ------------------------------ | ---- | ---------------------------------------------- |
|     0 | Repository Foundation          | 완료 | Monorepo, CI, Docker, PostgreSQL, Redis, MinIO |
|     1 | Platform Core                  | 다음 | 공통 API·DB·Transaction·Audit·Outbox 기반      |
|     2 | Admin Identity & Security      | 예정 | OWNER 로그인, MFA, Session, RBAC               |
|     3 | Workspace & Site               | 예정 | 다중 Site 등록과 설정                          |
|     4 | API Client & Delivery Boundary | 예정 | Site별 Server-to-server 인증                   |
|     5 | Content Core                   | 예정 | Markdown Content와 불변 Revision               |
|     6 | Publication & Delivery MVP     | 예정 | Site별 게시와 Delivery API                     |
|     7 | MinIO Media                    | 예정 | 원본 Upload와 공개 Variant                     |
|     8 | Event, Webhook & Scheduling    | 예정 | 예약 게시와 Site Revalidation                  |
|     9 | Content Operations             | 예정 | 분류, Redirect, Navigation, Search, Feed       |
|    10 | Project & History              | 예정 | 프로젝트, Repository, Release, Timeline        |
|    11 | Deployment & Operations        | 예정 | 배포 Callback, 상태, Health, Rollback 기록     |
|    12 | Personal Resource Library      | 예정 | 개인 자료, Collection, 관계, 검색              |
|    13 | Member Management              | 예정 | 다중 Site 회원과 Session·Consent 관리          |
|    14 | Dashboard & Notification       | 예정 | 조치 중심 Dashboard와 알림                     |
|    15 | Production Hardening           | 예정 | Backup, 보안, 관측성, 운영 배포                |

의존 관계:

```text
Phase 0
  ↓
Phase 1 Platform Core
  ↓
Phase 2 Admin Identity
  ↓
Phase 3 Workspace / Site
  ↓
Phase 4 API Client
  ↓
Phase 5 Content Core
  ↓
Phase 6 Publication / Delivery MVP
  ├─→ Phase 7 MinIO Media
  │     ↓
  └─→ Phase 8 Event / Webhook / Scheduling
         ↓
       Phase 9 Content Operations

Phase 3
  ├─→ Phase 10 Project
  │     ↓
  │   Phase 11 Deployment
  ├─→ Phase 12 Resource
  └─→ Phase 13 Member

전체 기능
  ↓
Phase 14 Dashboard
  ↓
Phase 15 Production Hardening
```

---

# 3. Phase별 구현 목록

## Phase 0. Repository Foundation

### 목표

개발자가 같은 명령과 같은 인프라에서 작업할 수 있는 기준선을 만든다.

### 현재 완료 항목

- [x] pnpm Workspace
- [x] Turborepo
- [x] `apps/admin-web`
- [x] `apps/api`
- [x] `apps/worker`
- [x] 공통 TypeScript 설정
- [x] ESLint와 Prettier
- [x] PostgreSQL, Redis, MinIO Docker Compose
- [x] MinIO Bucket과 Policy Bootstrap
- [x] TypeORM DataSource와 Migration 명령 기반
- [x] Object Storage Port와 MinIO Adapter 골격
- [x] API Health Check
- [x] Dockerfile과 Nginx 골격
- [x] GitHub Actions CI
- [x] Frozen Lockfile 검증

### 보완 항목

- [ ] Local Bootstrap Script를 macOS와 Ubuntu에서 각각 검증
- [ ] `docker compose config`를 CI에 추가
- [ ] Testcontainers 또는 Integration Test용 Compose 정책 결정
- [ ] `.env.example`과 Config Schema 일치 Test
- [ ] Dependency Update 정책 문서화

### 완료 기준

- 새 환경에서 README 순서만으로 실행할 수 있다.
- `pnpm check`가 통과한다.
- PostgreSQL, Redis, MinIO Readiness가 정상이다.

---

## Phase 1. Platform Core

### 목표

이후 모든 도메인 모듈이 같은 방식으로 API, DB, 오류, Audit와 Event를 처리하게 한다.

### Backend 구조

- [ ] `RequestContextModule`
  - [ ] `requestId`
  - [ ] `traceId`
  - [ ] `actorType`
  - [ ] `actorId`
  - [ ] `workspaceId`
  - [ ] `siteId`
- [ ] 전역 `ExceptionFilter`
- [ ] `application/problem+json` 오류 계약
- [ ] 공통 Error Code Registry
- [ ] Cursor Pagination DTO와 Codec
- [ ] Sort·Filter Allowlist
- [ ] UUIDv7 생성기
- [ ] UTC Clock Port
- [ ] Optimistic Lock 규칙
- [ ] `If-Match` 또는 `version` 처리
- [ ] 공통 Transaction Runner
- [ ] Idempotency Interceptor와 저장소
- [ ] Pino Request Logging
- [ ] Secret Redaction

### 데이터 모델

- [ ] `audit_logs`
- [ ] `outbox_events`
- [ ] `idempotency_records`
- [ ] 공통 Timestamp와 Version 규칙
- [ ] Migration naming 규칙
- [ ] Partial Unique Index 작성 방식

### Audit 기반

- [ ] `AuditService`
- [ ] 성공·실패 결과 기록
- [ ] Actor Snapshot
- [ ] Before·After JSON Redaction
- [ ] Audit 대상 Decorator
- [ ] Audit 조회 Repository Port

### Outbox 기반

- [ ] Domain Event 공통 Envelope
- [ ] 동일 Transaction 내 Outbox 저장
- [ ] Outbox Poller 기본 골격
- [ ] Lock과 중복 처리 규칙
- [ ] Retry Count와 `availableAt`
- [ ] Dead 상태 정의

### Admin Web 기반

- [ ] API Client 공통 Fetcher
- [ ] Problem Details Parser
- [ ] Query Key 규칙
- [ ] 전역 Error Boundary
- [ ] Toast와 Form Error 표시
- [ ] Loading·Empty·Error 공통 상태

### Test

- [ ] Error Contract Integration Test
- [ ] Pagination Unit Test
- [ ] Optimistic Lock Integration Test
- [ ] Idempotency Integration Test
- [ ] Audit Redaction Test
- [ ] Outbox Transaction Test

### 완료 기준

```text
샘플 Command 실행
→ DB 변경
→ Audit 생성
→ Outbox 생성
→ 공통 성공 응답
```

실패 시 공통 오류 응답과 실패 Audit가 생성된다.

---

## Phase 2. Admin Identity & Security

### 목표

OWNER가 안전하게 로그인하고 관리자 Shell에 진입한다.

### Entity

- [ ] `AdminAccount`
- [ ] `Role`
- [ ] `Permission`
- [ ] `AdminAccountRole`
- [ ] `RolePermission`
- [ ] `AdminSession`
- [ ] `MfaMethod`
- [ ] `RecoveryCode`
- [ ] `LoginAttempt`
- [ ] `ReauthChallenge`

### Bootstrap

- [ ] 최초 OWNER 생성 CLI
- [ ] 중복 Bootstrap 차단
- [ ] Password 입력 시 Shell History 노출 방지
- [ ] Argon2id Password Hash
- [ ] 기본 Role·Permission Seed
- [ ] Recovery Code 생성

### 인증 API

- [ ] `POST /api/admin/v1/auth/login`
- [ ] `POST /api/admin/v1/auth/mfa/verify`
- [ ] `POST /api/admin/v1/auth/logout`
- [ ] `GET /api/admin/v1/auth/session`
- [ ] `GET /api/admin/v1/auth/sessions`
- [ ] `DELETE /api/admin/v1/auth/sessions/{id}`
- [ ] `POST /api/admin/v1/auth/reauth`
- [ ] Password 변경
- [ ] TOTP 등록·재등록
- [ ] Recovery Code 재발급

### 보안

- [ ] Server-side Session
- [ ] Session Token Hash 저장
- [ ] `HttpOnly`, `Secure`, `SameSite=Strict`
- [ ] CSRF Token
- [ ] Login Rate Limit
- [ ] Account Lock 정책
- [ ] Session Idle Timeout
- [ ] Absolute Session Timeout
- [ ] 위험 작업 Reauthentication
- [ ] 로그인·MFA·세션 폐기 Audit

### RBAC

- [ ] `PermissionGuard`
- [ ] `@RequirePermissions()` Decorator
- [ ] OWNER 우회 정책 금지 또는 명시적 정책 결정
- [ ] API와 UI Permission Mapping
- [ ] 권한 없는 메뉴 숨김과 API 403 처리

### Admin UI

```text
/login
/login/mfa
/setup/mfa
/admin
/admin/security/sessions
/admin/security/recovery-codes
```

- [ ] Login Form
- [ ] MFA Form
- [ ] 관리자 Layout
- [ ] Sidebar
- [ ] Topbar
- [ ] 현재 사용자 메뉴
- [ ] Session 관리 화면
- [ ] 로그아웃

### Test

- [ ] 로그인 성공·실패
- [ ] MFA Required
- [ ] CSRF 차단
- [ ] Session 만료와 폐기
- [ ] Rate Limit
- [ ] Permission Matrix
- [ ] Cookie가 외부 Site Domain과 공유되지 않는지 확인

### 완료 기준

- OWNER가 Password와 MFA로 로그인한다.
- 미인증 요청은 `401`, 권한 없는 요청은 `403`을 반환한다.
- 로그인과 세션 변경이 Audit에 기록된다.

---

## Phase 3. Workspace & Site

### 목표

하나의 Workspace에서 여러 블로그·포트폴리오·문서 Site를 독립 관리한다.

### Entity

- [ ] `Workspace`
- [ ] `WorkspaceMember` 또는 Admin Workspace Access
- [ ] `Site`
- [ ] `SiteDomain`
- [ ] `SiteSetting`
- [ ] `SiteSecretReference`

### Workspace

- [ ] 기본 Workspace Bootstrap
- [ ] Workspace 조회·수정
- [ ] Timezone과 Locale
- [ ] Workspace 상태
- [ ] 향후 다중 Workspace를 막지 않는 Context Resolver

### Site

- [ ] Site CRUD
- [ ] Site Type
- [ ] 상태 전이
  - [ ] `DRAFT`
  - [ ] `ACTIVE`
  - [ ] `MAINTENANCE`
  - [ ] `DISABLED`
  - [ ] `ARCHIVED`
- [ ] Canonical Domain
- [ ] Domain 중복 검증
- [ ] Domain Verification 상태
- [ ] Site Setting Version 관리
- [ ] Branding 설정
- [ ] SEO Default
- [ ] Feed 설정
- [ ] Member Feature Flag
- [ ] Webhook Policy

### Admin API

- [ ] Workspace Endpoint
- [ ] Site 목록·상세·생성·수정
- [ ] Site 활성화·비활성화
- [ ] Domain CRUD
- [ ] Setting 조회·수정
- [ ] Site별 사용량 Summary 골격

### Admin UI

```text
/admin/sites
/admin/sites/new
/admin/sites/{siteId}
/admin/sites/{siteId}/domains
/admin/sites/{siteId}/settings
```

- [ ] Site List
- [ ] Site Create Wizard
- [ ] Site Detail Tabs
- [ ] Domain 관리
- [ ] Setting Form
- [ ] 전역 Site Switcher
- [ ] All Sites Filter

### Test

- [ ] `UNIQUE(workspace_id, key)`
- [ ] Canonical Domain 한 개 제한
- [ ] 다른 Workspace 접근 차단
- [ ] Archived Site 수정 정책
- [ ] Site 상태 전이

### 완료 기준

- `main-blog`, `dev-log` 두 Site를 생성할 수 있다.
- Site마다 Domain과 설정이 독립적으로 유지된다.
- 모든 관리자 조회가 Workspace 범위로 제한된다.

---

## Phase 4. API Client & Delivery Boundary

### 목표

외부 Site와 CI가 관리자 Session과 분리된 자격증명으로 필요한 API만 호출한다.

### Entity

- [ ] `ApiClient`
- [ ] `ApiClientKey`
- [ ] `ApiClientScope`
- [ ] `ApiClientSiteAccess`
- [ ] `ApiClientUsage`

### Key 관리

- [ ] Key Prefix와 Secret 생성
- [ ] Secret 원문 1회 표시
- [ ] Argon2id 또는 적절한 Key Hash
- [ ] Key Rotation
- [ ] Key Revocation
- [ ] Expiration
- [ ] Last Used At
- [ ] 허용 IP 정책은 Optional로 설계

### 인증 Guard

- [ ] Bearer Parser
- [ ] Key Prefix로 Candidate 조회
- [ ] Constant-time 검증
- [ ] Scope Guard
- [ ] Site Access Guard
- [ ] Rate Limit
- [ ] Usage Audit

### Scope

```text
site:read
content:read
feed:read
deployment:create
deployment:update
release:write
health:write
```

### Admin UI

```text
/admin/sites/{siteId}/api-clients
/admin/system/api-clients
```

- [ ] API Client 목록
- [ ] 발급 Modal
- [ ] Secret 1회 표시와 복사 경고
- [ ] Scope 선택
- [ ] Site Access 선택
- [ ] Rotate
- [ ] Revoke
- [ ] Last Used 표시

### Test

- [ ] Site A Key로 Site A 접근
- [ ] Site A Key로 Site B 접근 시 `403 SITE_NOT_ACCESSIBLE`
- [ ] Scope 부족 시 403
- [ ] 만료·폐기 Key 거부
- [ ] 원문 Secret DB 미저장 확인

### 완료 기준

Site별 Delivery Client를 발급하고 인증된 빈 Delivery Endpoint를 호출할 수 있다.

---

## Phase 5. Content Core

### 목표

Site와 분리된 원본 Content를 작성하고 불변 Revision으로 이력을 보존한다.

### 초기 Content Type

```text
POST
PAGE
PROJECT
RESUME
PRIVATE_DOCUMENT
```

첫 구현은 `POST`만 UI까지 완성하고 나머지는 Schema 확장 가능성만 유지한다.

### Entity

- [ ] `Content`
- [ ] `ContentRevision`
- [ ] `ContentRelation`
- [ ] `ContentRedirect` 골격

### Domain 규칙

- [ ] `DRAFT → READY → ARCHIVED`
- [ ] Revision 생성 후 수정 금지
- [ ] Revision Number 단조 증가
- [ ] Content Hash 중복 처리
- [ ] 현재 Revision Pointer
- [ ] Optimistic Lock
- [ ] Archive 정책
- [ ] Markdown Sanitization 정책
- [ ] 허용 HTML·MDX 정책

### Admin API

- [ ] Content 목록
- [ ] Content 상세
- [ ] Content 생성
- [ ] Metadata 수정
- [ ] Revision 생성
- [ ] Revision 목록·상세
- [ ] Revision Restore
- [ ] READY 전환
- [ ] DRAFT 복귀
- [ ] Archive
- [ ] Validation Endpoint

### Editor 1차 범위

고급 WYSIWYG보다 안정적인 Markdown Source Mode부터 구현한다.

- [ ] Title
- [ ] Summary
- [ ] Markdown Textarea 또는 Code Editor
- [ ] Server Preview
- [ ] Autosave
- [ ] Save State
- [ ] Version Conflict UI
- [ ] Local Draft Recovery
- [ ] Metadata Panel
- [ ] Revision Note

### Admin UI

```text
/admin/contents
/admin/contents/new
/admin/contents/{contentId}
/admin/contents/{contentId}/revisions
/admin/contents/{contentId}/revisions/{revisionId}
```

### Test

- [ ] Revision 불변성
- [ ] 동시 수정 충돌
- [ ] READY 검증
- [ ] Restore가 새 Revision을 생성하는지 확인
- [ ] 다른 Workspace Content 접근 차단
- [ ] Markdown Sanitization

### 완료 기준

- Markdown 글을 작성하고 Revision을 생성한다.
- 이전 Revision을 조회하고 복구할 수 있다.
- READY 조건을 통과하지 못한 글은 READY로 전환할 수 없다.

---

## Phase 6. Publication & Delivery MVP

### 목표

하나의 Content를 하나 이상의 Site에 배치하고, Site별 불변 Publication을 Delivery API로 제공한다.

### Entity

- [ ] `ContentSite`
- [ ] `ContentPublication`
- [ ] `PublicationAttempt`
- [ ] `ContentSiteTerm` 골격

### Site 배치

- [ ] Site별 `slug`
- [ ] Site별 `route`
- [ ] Title Override
- [ ] Summary Override
- [ ] SEO Override
- [ ] Visibility
- [ ] Scheduled At 필드
- [ ] Active Publication Pointer
- [ ] `UNIQUE(site_id, route)`

### Publication

- [ ] Publish Validation
- [ ] Revision Snapshot
- [ ] 이전 ACTIVE를 SUPERSEDED 처리
- [ ] ACTIVE Partial Unique Index
- [ ] Unpublish
- [ ] Withdraw
- [ ] Republish
- [ ] 이전 Publication 복구
- [ ] ETag 생성
- [ ] Publication Audit
- [ ] 동일 요청 Idempotency

### Delivery API 1차

```http
GET /api/delivery/v1/sites/{siteKey}
GET /api/delivery/v1/sites/{siteKey}/posts
GET /api/delivery/v1/sites/{siteKey}/posts/{slug}
```

- [ ] ACTIVE Publication만 반환
- [ ] Cursor Pagination
- [ ] ETag와 `304 Not Modified`
- [ ] Cache-Control
- [ ] 내부 Entity와 Storage 정보 미노출
- [ ] 공개 DTO Version 고정
- [ ] Not Found와 Withdraw 정책

### Admin UI

```text
/admin/contents/{contentId}/sites
/admin/content-sites/{contentSiteId}
/admin/content-sites/{contentSiteId}/publications
```

- [ ] Site 배치 Dialog
- [ ] Site별 slug·SEO Form
- [ ] Publish Validation 표시
- [ ] Publish 확인 Dialog
- [ ] Site별 현재 게시 상태
- [ ] Publication History
- [ ] Unpublish와 Restore

### E2E 핵심 시나리오

```text
Content 생성
→ Revision 생성
→ READY
→ main-blog 배치
→ Publish
→ main-blog API Key로 조회
→ 새 Revision 생성
→ 기존 공개 응답 유지
→ Republish
→ 새 응답과 ETag 확인
```

### 완료 기준

이 Phase가 완료되면 텍스트 기반 다중 Site CMS로 실제 사용할 수 있다.

---

## Phase 7. MinIO Media

### 목표

원본을 안전하게 보관하고 공개 Site에는 가공된 Variant만 제공한다.

### Entity

- [ ] `Asset`
- [ ] `AssetVariant`
- [ ] `AssetUsage`
- [ ] `UploadSession`
- [ ] `AssetProcessingAttempt`

### Upload

- [ ] Upload Session 생성
- [ ] MIME Allowlist
- [ ] 크기 제한
- [ ] 안전한 Object Key
- [ ] Presigned PUT
- [ ] Upload Complete
- [ ] `statObject` 검증
- [ ] Checksum 검증
- [ ] 만료 Session 정리
- [ ] 중복 파일 감지

### Worker

- [ ] `media.process` Queue
- [ ] 이미지 Decode 검증
- [ ] EXIF 위치 정보 제거
- [ ] Thumbnail 320 WebP
- [ ] Card 768 WebP
- [ ] Content 1280 WebP
- [ ] Content 1920 AVIF
- [ ] 실패 Retry
- [ ] Quarantine
- [ ] Processing Object 정리

### Content 연동

- [ ] `asset://{assetId}` Parser
- [ ] Asset Picker
- [ ] Alt Text
- [ ] Caption
- [ ] Cover Asset
- [ ] Publication Asset Manifest
- [ ] Publish 시 Asset READY 검사
- [ ] Public URL 변환
- [ ] ACTIVE Publication 사용량 추적

### Admin UI

```text
/admin/media
/admin/media/{assetId}
```

- [ ] Upload Dropzone
- [ ] Upload Progress
- [ ] Asset Grid
- [ ] 검색과 Filter
- [ ] Asset Detail
- [ ] Variant 상태
- [ ] 사용 위치
- [ ] Regenerate
- [ ] 삭제 가능 여부

### 운영

- [ ] MinIO Usage Metrics
- [ ] Bucket Versioning
- [ ] Garbage Collection 후보 조회
- [ ] Soft Delete
- [ ] NAS Mirror Job
- [ ] 복구 Runbook

### 완료 기준

- 브라우저가 Atlas API를 경유하지 않고 MinIO로 원본을 업로드한다.
- Worker가 공개 Variant를 생성한다.
- Delivery API에 내부 Bucket·Object Key가 포함되지 않는다.
- 사용 중인 Variant는 삭제되지 않는다.

---

## Phase 8. Event, Webhook & Scheduling

### 목표

게시 후 Site Cache를 갱신하고 예약 작업을 신뢰성 있게 처리한다.

### Outbox Worker

- [ ] Polling과 Claim Lock
- [ ] Worker Crash 복구
- [ ] At-least-once 처리
- [ ] Consumer Idempotency
- [ ] Retry Backoff
- [ ] Dead Letter 상태
- [ ] 수동 재처리

### Webhook

- [ ] `WebhookEndpoint`
- [ ] `WebhookDelivery`
- [ ] HMAC SHA-256 서명
- [ ] Timestamp Header
- [ ] Event ID
- [ ] Site별 구독 Event
- [ ] 응답 Body 제한 저장
- [ ] Secret 암호화 저장
- [ ] Retry Schedule
- [ ] Disable 정책

### Event

```text
content.published
content.unpublished
content.slug.changed
media.ready
site.activated
```

### 예약 게시

- [ ] `SCHEDULED` 상태
- [ ] Site Timezone 입력
- [ ] UTC 저장
- [ ] Due Job Scanner
- [ ] 실행 직전 재검증
- [ ] 중복 실행 방지
- [ ] 실패 상태와 관리자 재시도
- [ ] 예약 취소

### Admin UI

```text
/admin/content/scheduled
/admin/sites/{siteId}/webhooks
/admin/system/webhook-deliveries
/admin/system/outbox
```

- [ ] 예약 목록
- [ ] Webhook Endpoint CRUD
- [ ] Delivery Timeline
- [ ] Payload와 응답 요약
- [ ] 수동 재전송
- [ ] Outbox 실패 조회

### 완료 기준

- Site A 게시 시 Site A Webhook만 호출한다.
- 같은 Event가 재처리되어도 중복 부작용이 없다.
- 예약 시간이 되면 Publication이 정확히 한 번 활성화된다.

---

## Phase 9. Content Operations

### 목표

장기적으로 콘텐츠를 운영하고 여러 Site를 구성하는 기능을 추가한다.

### Taxonomy

- [ ] Site별 Category
- [ ] Site별 Tag
- [ ] 계층 Category
- [ ] Slug 충돌 검사
- [ ] ContentSite 연결
- [ ] Delivery 목록 Filter

### URL 운영

- [ ] Slug 변경 이력
- [ ] Redirect
- [ ] 301·302·410 정책
- [ ] Broken Link 검사
- [ ] 내부 Link Resolver

### Site 구성

- [ ] Navigation
- [ ] Home Section
- [ ] Featured Content
- [ ] Site별 Section 순서
- [ ] Banner와 공지
- [ ] SEO Default Merge

### Delivery 확장

```http
GET /home
GET /pages/{slug}
GET /categories
GET /categories/{slug}/posts
GET /tags
GET /tags/{slug}/posts
GET /archive
GET /feed
GET /sitemap
```

- [ ] RSS
- [ ] JSON Feed
- [ ] Sitemap
- [ ] Search Index
- [ ] OpenGraph Data
- [ ] JSON-LD Data

### Editor 고도화

- [ ] Split Preview
- [ ] Outline
- [ ] Internal Link Autocomplete
- [ ] Asset Slash Command
- [ ] Revision Diff
- [ ] Find and Replace
- [ ] Keyboard Shortcut
- [ ] 선택적으로 Milkdown 또는 동등 Editor 도입

### 완료 기준

Site가 Atlas Delivery API만으로 기본 블로그 Navigation, 목록, 상세, Feed와 Sitemap을 구성할 수 있다.

---

## Phase 10. Project & History

### 목표

개인 프로젝트의 현재 상태와 결정·릴리스·운영 이력을 한 Timeline에서 관리한다.

### Entity

- [ ] `Project`
- [ ] `ProjectEvent`
- [ ] `RepositoryConnection`
- [ ] `Release`
- [ ] `ProjectLink`
- [ ] `ProjectRelation`

### Project

- [ ] 상태 전이
- [ ] Visibility
- [ ] 시작·완료 일자
- [ ] 기술 스택
- [ ] Repository 연결
- [ ] Site 연결
- [ ] 관련 Content 연결
- [ ] 대표 Asset

### Timeline

```text
PROJECT_STARTED
MILESTONE_COMPLETED
DECISION_RECORDED
ARCHITECTURE_CHANGED
RELEASED
DEPLOYED
INCIDENT_OCCURRED
MAINTENANCE
PROJECT_PAUSED
PROJECT_COMPLETED
```

- [ ] 수동 Event
- [ ] Release·Deployment 자동 Event
- [ ] 시간순 조회
- [ ] Filter
- [ ] 관련 Resource 연결

### Admin UI

```text
/admin/projects
/admin/projects/new
/admin/projects/{projectId}
/admin/projects/{projectId}/timeline
/admin/projects/{projectId}/repositories
/admin/projects/{projectId}/releases
```

### 완료 기준

프로젝트 상세에서 설명, Repository, Release, 관련 글과 전체 Timeline을 조회할 수 있다.

---

## Phase 11. Deployment & Operations

### 목표

CI/CD가 전송한 배포 정보와 실제 서비스 Health를 분리해 기록하고 운영 상태를 관리한다.

### Entity

- [ ] `Environment`
- [ ] `Service`
- [ ] `ServiceEnvironment`
- [ ] `Deployment`
- [ ] `DeploymentEvent`
- [ ] `HealthCheck`
- [ ] `DeploymentLock`
- [ ] `Incident`

### Integration API

- [ ] Release 생성
- [ ] Deployment 시작
- [ ] Event 추가
- [ ] Deployment 완료
- [ ] Health Check 결과
- [ ] Idempotency-Key
- [ ] CI 전용 Scope
- [ ] Callback Signature 또는 API Key

### 상태

```text
Deployment
QUEUED
RUNNING
SUCCEEDED
FAILED
CANCELED
ROLLED_BACK

Service Health
HEALTHY
DEGRADED
DOWN
UNKNOWN
```

### 운영 기능

- [ ] 현재 환경별 Release
- [ ] 최근 성공 Deployment
- [ ] 최근 실패 원인
- [ ] Deployment Lock
- [ ] Maintenance Mode Metadata
- [ ] Rollback Request Record
- [ ] Rollback 결과
- [ ] Health History
- [ ] Incident 연결
- [ ] 배포 전후 오류 비교는 후속 연동으로 분리

### Admin UI

```text
/admin/operations/services
/admin/operations/environments
/admin/operations/deployments
/admin/operations/deployments/{deploymentId}
/admin/operations/incidents
```

- [ ] Deployment 목록
- [ ] 진행 Timeline
- [ ] Release·Commit SHA
- [ ] Workflow·Log Link
- [ ] Health 결과
- [ ] 실패 Error Code
- [ ] Rollback 확인 Dialog

### 안전 경계

- [ ] 초기에는 CI Workflow Trigger와 상태 수집만 지원
- [ ] Browser에서 Docker Socket 접근 금지
- [ ] 임의 Shell 명령 금지
- [ ] Rollback은 Reauthentication 요구
- [ ] DB Down Migration 자동 실행 금지

### 완료 기준

- CI Callback으로 중복 없이 Deployment를 생성한다.
- 배포 성공과 Health 실패를 별도로 표시한다.
- 현재 Site가 어떤 Release로 운영되는지 확인할 수 있다.

---

## Phase 12. Personal Resource Library

### 목표

개인 문서·메모·링크·참조 자료를 프로젝트와 콘텐츠에 연결해 관리한다.

### Entity

- [ ] `ResourceCollection`
- [ ] `Resource`
- [ ] `ResourceAsset`
- [ ] `ResourceRelation`
- [ ] `ResourceTag`

### Resource Type

```text
NOTE
DOCUMENT
LINK
REFERENCE
CHECKLIST
SNIPPET
```

### 기능

- [ ] 계층 Collection
- [ ] Markdown 본문
- [ ] 외부 URL
- [ ] Asset 첨부
- [ ] Tag
- [ ] Project 연결
- [ ] Content 연결
- [ ] Related Resource
- [ ] Visibility
- [ ] Sensitivity
- [ ] Archive
- [ ] Full Text Search
- [ ] PUBLIC_CANDIDATE에서 Content 생성

### 보안

- [ ] 비밀번호·Token·Private Key 입력 경고
- [ ] Secret Pattern Redaction 또는 차단 정책
- [ ] Secret Store Reference만 허용
- [ ] 민감 자료 조회 Audit

### Admin UI

```text
/admin/resources
/admin/resources/{resourceId}
/admin/resource-collections/{collectionId}
```

### 완료 기준

자료를 Collection에 정리하고 프로젝트·콘텐츠와 양방향으로 탐색할 수 있다.

---

## Phase 13. Member Management

### 목표

회원 Identity는 Workspace에서 공유하고 가입 상태와 역할은 Site별로 독립 관리한다.

### Entity

- [ ] `Member`
- [ ] `MemberIdentity`
- [ ] `SiteMembership`
- [ ] `MemberSession`
- [ ] `MemberConsent`
- [ ] `MemberAdminNote`
- [ ] `EmailVerificationToken`
- [ ] `PasswordResetToken`

### 관리자 기능

- [ ] 전체 회원 목록
- [ ] Site별 회원 Filter
- [ ] 회원 상세
- [ ] Site Membership
- [ ] 활성화
- [ ] 정지
- [ ] 탈퇴
- [ ] Session 강제 폐기
- [ ] Consent History
- [ ] 관리자 메모
- [ ] 개인정보 Export
- [ ] 익명화 Job

### Member API

```http
POST /api/member/v1/auth/register
POST /api/member/v1/auth/login
POST /api/member/v1/auth/logout
GET  /api/member/v1/me
GET  /api/member/v1/memberships
```

Member API는 실제 Site에서 회원 기능을 사용할 시점에 활성화한다.

### 다중 Site 규칙

- [ ] 동일 이메일의 Workspace Identity 통합 정책
- [ ] Site별 상태 독립
- [ ] Site별 역할 독립
- [ ] Site별 Consent 문서 버전
- [ ] Site A 정지가 Site B 로그인에 미치는 영향 정의
- [ ] Global Suspension 정책

### 보안과 개인정보

- [ ] Member Session과 Admin Session 완전 분리
- [ ] Password Hash
- [ ] Email Verification
- [ ] Login Rate Limit
- [ ] 회원 정보 조회 Audit
- [ ] 탈퇴 보존 기간
- [ ] 익명화와 법적 보존 필드 분리

### 완료 기준

한 Member가 여러 Site에 가입하고 Site별 상태를 독립적으로 관리할 수 있다.

---

## Phase 14. Dashboard & Notification

### 목표

단순 통계가 아니라 관리자가 조치해야 할 항목을 우선 보여준다.

### Dashboard Widget

- [ ] Draft 개수
- [ ] READY 콘텐츠
- [ ] 예약 게시
- [ ] 최근 Publication
- [ ] Webhook 실패
- [ ] Media 처리 실패
- [ ] 최근 Deployment
- [ ] 실패 Deployment
- [ ] 비정상 Service
- [ ] 활성 Incident
- [ ] MinIO 사용량
- [ ] Backup 상태
- [ ] 관리자 최근 작업

### Notification

- [ ] `Notification`
- [ ] 읽음·미읽음
- [ ] Severity
- [ ] Target Link
- [ ] Deduplication Key
- [ ] 실패 Job에서 Notification 생성
- [ ] 배포 실패 Notification
- [ ] 인증서·Backup 경고는 외부 Monitoring 연동 후 추가

### UX

- [ ] Quick Action
- [ ] 최근 작업
- [ ] Command Palette
- [ ] 전역 검색
- [ ] 즐겨찾기
- [ ] Site Context 유지

### 완료 기준

로그인 직후 실패 작업과 필요한 조치를 한 화면에서 확인할 수 있다.

---

## Phase 15. Production Hardening

### 목표

`develop → main → Tag → Production` 흐름으로 안전하게 배포하고 복구할 수 있다.

### 보안

- [ ] Admin Domain 분리
- [ ] TLS
- [ ] Security Header
- [ ] CSP
- [ ] Nginx Rate Limit
- [ ] Request Body 제한
- [ ] MinIO Console 내부망 제한
- [ ] Credential Rotation Runbook
- [ ] Dependency Audit
- [ ] Container Non-root
- [ ] Read-only Filesystem 적용 가능성 검증
- [ ] Secret Scan
- [ ] Backup 파일 암호화

### 관측성

- [ ] Prometheus Metrics
- [ ] HTTP Latency
- [ ] Queue Depth
- [ ] Outbox Lag
- [ ] Webhook Failure Rate
- [ ] DB Pool
- [ ] Redis Health
- [ ] MinIO Health와 Usage
- [ ] Structured Log → Loki
- [ ] Alert Rule
- [ ] Trace ID 연결

### Backup

- [ ] PostgreSQL 정기 Backup
- [ ] Restore Drill
- [ ] MinIO `mc mirror`
- [ ] Bucket Versioning
- [ ] Backup 결과 기록
- [ ] DB와 MinIO 일관 시점 기록
- [ ] Retention
- [ ] Disaster Recovery Runbook

### CI/CD

- [ ] Pull Request Quality Gate
- [ ] Container Image SHA Tag
- [ ] SBOM
- [ ] Vulnerability Scan
- [ ] Migration Precheck
- [ ] LAB 자동 배포
- [ ] PRODUCTION 수동 승인
- [ ] Health Check
- [ ] Deployment Record Callback
- [ ] 이전 Image Rollback
- [ ] DB 자동 Down Migration 금지

### 운영 검증

- [ ] 관리자 Session 장애 시 대응
- [ ] PostgreSQL 복구
- [ ] Redis 초기화 후 복구
- [ ] MinIO 장애 시 기존 Site Cache 유지
- [ ] Worker 중단 시 예약 Job 복구
- [ ] Webhook 수신 Site 장애 시 재시도
- [ ] API 장애 시 외부 Site의 Stale Cache 제공

### 완료 기준

- Production 배포와 이전 Image Rollback을 재현할 수 있다.
- PostgreSQL과 MinIO Restore Drill이 성공한다.
- 주요 장애가 Alert와 Runbook에 연결된다.

---

# 4. 모듈별 목록

| 모듈            | 주요 책임                                           | 선행 모듈                      |
| --------------- | --------------------------------------------------- | ------------------------------ |
| `platform-core` | 오류, Context, Transaction, Pagination, Idempotency | Foundation                     |
| `audit`         | 운영 변경 감사 기록                                 | platform-core                  |
| `outbox`        | Transactional Event 저장과 전달                     | platform-core                  |
| `identity`      | 관리자 인증, MFA, Session, RBAC                     | audit                          |
| `workspace`     | 최상위 데이터 경계                                  | identity                       |
| `site`          | 다중 외부 Site와 Domain·Setting                     | workspace                      |
| `api-client`    | Delivery·Integration API Key                        | site, identity                 |
| `content`       | 원본 Content와 Revision                             | workspace, identity            |
| `publication`   | Site 배치, Snapshot, 게시 상태                      | content, site, audit, outbox   |
| `delivery`      | 외부 읽기 API                                       | publication, api-client        |
| `media`         | MinIO Asset와 Variant                               | workspace, outbox              |
| `webhook`       | Site Revalidation과 Retry                           | site, outbox                   |
| `scheduler`     | 예약 게시와 정기 Job                                | publication, outbox            |
| `taxonomy`      | Site별 Category와 Tag                               | site, content                  |
| `navigation`    | Site Navigation과 Home Curation                     | site, publication              |
| `search`        | 공개·관리 검색                                      | content, publication, resource |
| `project`       | 프로젝트와 Timeline                                 | workspace                      |
| `deployment`    | Release, 환경, 배포, Health                         | project, api-client, outbox    |
| `resource`      | 개인 자료와 관계                                    | workspace, media               |
| `member`        | 일반 회원과 Site Membership                         | workspace, site, audit         |
| `notification`  | 실패·경고·조치 알림                                 | 전체 Event                     |
| `dashboard`     | 운영 Summary와 Quick Action                         | 각 도메인 Query                |

---

# 5. Queue 목록

초기부터 Queue 이름과 Payload Version을 고정한다.

```text
atlas-outbox
├─ dispatch-event
└─ recover-stale-event

atlas-media
├─ process-asset
├─ regenerate-variants
├─ cleanup-processing
└─ garbage-collect

atlas-publication
├─ publish-scheduled
├─ rebuild-feed
├─ rebuild-sitemap
└─ validate-links

atlas-webhook
├─ deliver
├─ retry
└─ disable-endpoint

atlas-deployment
├─ poll-external-status
├─ run-health-check
└─ summarize-failure

atlas-member
├─ anonymize-member
└─ expire-sessions

atlas-maintenance
├─ cleanup-upload-sessions
├─ cleanup-idempotency-records
├─ backup-status-check
└─ storage-usage-snapshot
```

모든 Job Payload에 포함할 필드:

```text
jobId
eventId nullable
schemaVersion
workspaceId
siteId nullable
requestedBy
requestedAt
correlationId
```

---

# 6. Admin Web 화면 목록

```text
/auth
├─ /login
├─ /mfa
└─ /recovery

/admin
├─ /dashboard
├─ /contents
│  ├─ /new
│  ├─ /{contentId}
│  ├─ /{contentId}/revisions
│  └─ /scheduled
├─ /media
│  └─ /{assetId}
├─ /sites
│  ├─ /new
│  └─ /{siteId}
│     ├─ /domains
│     ├─ /settings
│     ├─ /api-clients
│     └─ /webhooks
├─ /projects
│  └─ /{projectId}
│     ├─ /timeline
│     ├─ /repositories
│     └─ /releases
├─ /operations
│  ├─ /services
│  ├─ /environments
│  ├─ /deployments
│  └─ /incidents
├─ /resources
│  └─ /{resourceId}
├─ /members
│  └─ /{memberId}
└─ /system
   ├─ /admins
   ├─ /roles
   ├─ /api-clients
   ├─ /sessions
   ├─ /audit
   ├─ /outbox
   ├─ /webhook-deliveries
   └─ /storage
```

각 목록 화면의 공통 기능:

- Cursor Pagination
- 검색
- Allowlist Filter
- URL Query State
- Empty State
- Error State
- Bulk Action은 실제 필요가 확인된 후 추가
- Permission에 따른 Action 노출

---

# 7. 공통 Definition of Done

모든 기능 PR은 해당되는 항목을 만족해야 한다.

## Backend

- [ ] Migration이 있다.
- [ ] Entity를 API Response에 직접 노출하지 않는다.
- [ ] Controller가 TypeORM Repository를 직접 호출하지 않는다.
- [ ] Workspace와 Site Scope가 적용된다.
- [ ] Permission이 선언돼 있다.
- [ ] 변경 작업에 Audit가 있다.
- [ ] 비동기 부작용은 Outbox를 사용한다.
- [ ] 오류 코드가 Registry에 등록돼 있다.
- [ ] OpenAPI에 반영돼 있다.
- [ ] Secret과 개인정보가 Log에서 Redact된다.

## Frontend

- [ ] Loading·Empty·Error 상태가 있다.
- [ ] Form Validation이 Server 규칙과 일치한다.
- [ ] API 오류 코드를 사용자 메시지로 변환한다.
- [ ] 권한 없는 Action을 노출하지 않는다.
- [ ] Version Conflict를 처리한다.
- [ ] 키보드와 기본 접근성을 확인한다.

## Test

- [ ] Domain Unit Test
- [ ] Repository Integration Test
- [ ] Controller 또는 API Integration Test
- [ ] 주요 사용자 흐름 E2E
- [ ] 권한·Scope 격리 Test
- [ ] 실패와 재시도 Test

## 운영

- [ ] Metric 또는 Log 필드가 정의돼 있다.
- [ ] 실패 상태를 관리자에서 확인할 수 있다.
- [ ] Retry 또는 복구 방법이 있다.
- [ ] 데이터 삭제와 보존 정책이 있다.
- [ ] 문서가 갱신됐다.

---

# 8. 권장 PR 분할 순서

큰 Phase를 한 PR로 만들지 않는다. 최초 구현은 다음 크기로 나눈다.

```text
01 chore/platform-core-contracts
02 feat/audit-outbox-foundation
03 feat/admin-identity-schema
04 feat/admin-auth-session
05 feat/admin-mfa-rbac
06 feat/admin-shell
07 feat/workspace-bootstrap
08 feat/site-management
09 feat/api-client-management
10 feat/delivery-auth-guard
11 feat/content-schema
12 feat/content-revision-api
13 feat/content-editor
14 feat/content-site-assignment
15 feat/publication-snapshot
16 feat/delivery-post-api
17 test/content-publication-e2e
18 feat/minio-upload-session
19 feat/media-worker
20 feat/asset-editor-integration
21 feat/webhook-delivery
22 feat/scheduled-publication
```

각 PR은 가능하면 다음 중 하나를 중심으로 한다.

```text
Schema + Migration
Domain + Application
API Contract
Admin UI
Worker / Integration
Test / Hardening
```

단, 사용자에게 보이는 수직 기능을 끝내기 위해 작은 Schema·API·UI 변경을 하나의 PR에 묶는 것은 허용한다.

---

# 9. 첫 번째 MVP와 이후 경계

## MVP-1: 관리자 기반

```text
Phase 0 ~ Phase 4
```

- 안전한 관리자 로그인
- Workspace와 Site 관리
- Site별 API Client

## MVP-2: 콘텐츠 제공

```text
Phase 5 ~ Phase 6
```

- Markdown Content
- Revision
- Site별 Publication
- Delivery API

이 시점부터 텍스트 기반 외부 블로그를 개발할 수 있다.

## MVP-3: 운영 가능한 CMS

```text
Phase 7 ~ Phase 9
```

- MinIO Media
- 예약 게시
- Webhook
- Taxonomy
- Feed·Sitemap·Search

## MVP-4: 개인 운영 콘솔

```text
Phase 10 ~ Phase 14
```

- 프로젝트와 이력
- 배포와 Health
- 개인 자료
- 회원
- Dashboard

## Production Release

```text
Phase 15
```

- 운영 보안
- Backup과 Restore
- Observability
- CI/CD와 Rollback

---

# 10. 바로 시작할 작업

현재 Phase 0 이후 첫 작업은 다음 순서로 진행한다.

```text
1. Request Context와 Problem Details
2. Base Migration 규칙과 UUIDv7
3. AuditLog Entity와 AuditService
4. OutboxEvent Entity와 Transaction Helper
5. IdempotencyRecord와 Interceptor
6. AdminAccount·Role·Permission Schema
7. OWNER Bootstrap CLI
8. Password Login
9. TOTP MFA
10. Admin Session과 CSRF
11. Permission Guard
12. Admin Layout과 Login UI
```

첫 번째 검증 시나리오:

```gherkin
Given OWNER 계정이 Bootstrap되어 있다
When 올바른 Password와 TOTP로 로그인한다
Then Admin Session Cookie가 발급된다
And Dashboard Shell에 접근할 수 있다
And 로그인 Audit가 저장된다
When 미인증 사용자가 Admin API를 요청한다
Then 401 AUTH_REQUIRED를 반환한다
```
