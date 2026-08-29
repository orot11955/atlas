# Atlas 전체 구현 로드맵

- 문서 상태: Draft v0.2
- 기준 브랜치: `develop`
- 기준 아키텍처: Next.js Admin Web + NestJS API + NestJS Worker
- 데이터 저장소: PostgreSQL + Redis + MinIO
- 목표: 관리자 패널의 실사용 시점을 앞당기고, 이후 다중 Site용 Headless CMS와 운영 제어 기능을 점진적으로 확장한다.
- 상세 체크리스트: [Phase별 구현 체크리스트](implementation/phase-checklists.md)
- 선행 결정: [구현 아키텍처 결정](implementation/architecture-decisions.md)
- 검증 기준: [Acceptance와 Release Gate](implementation/acceptance-gates.md)

이 문서는 기존 Draft v0.1의 순서를 대체한다. 기존 계획의 다중 Site, 불변 Publication, MinIO, NestJS Modular Monolith 방향은 유지하되 다음 내용을 수정한다.

```text
CMS 고도화보다 관리자 패널 실사용 기능을 먼저 제공
Platform Core를 필요한 최소 범위로 축소
ContentDraft와 ContentRevision 분리
Publication 상태의 단일 Source of Truth 확정
Project/Deployment Read Model을 앞당김
Member Directory와 Member Authentication 분리
보안과 Backup을 마지막 Phase가 아닌 단계별 Gate로 적용
API와 Worker가 공유하는 Server Module을 apps/api 밖으로 이동
```

---

## 1. 제품 구현 우선순위

Atlas는 다음 순서로 가치를 제공한다.

```text
1. 안전하게 로그인할 수 있는 관리자 패널
2. 프로젝트, 배포 상태, 개인 자료와 회원 목록을 관리하는 개인 운영 화면
3. 글을 작성하고 여러 Site에 게시하는 Headless CMS
4. MinIO 미디어, 예약 게시, Webhook과 콘텐츠 운영 기능
5. 배포 제어, 회원 인증, 알림과 운영 안정화
```

첫 번째 실사용 목표는 단순히 로그인 가능한 빈 관리자 화면이 아니다.

```text
OWNER 로그인
→ Site 등록
→ 프로젝트 등록
→ CI Deployment Callback 수신
→ 개인 자료 저장
→ Site별 회원 상태 조회
```

첫 번째 CMS 목표는 다음 수직 흐름이다.

```text
ContentDraft Autosave
→ ContentRevision 생성
→ Site 배치
→ Publication 생성
→ Delivery API 조회
```

---

## 2. 구현 원칙

### 2.1 수직 기능 단위로 완료한다

각 기능은 가능한 한 다음 흐름을 한 PR 또는 연속된 작은 PR로 완성한다.

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

Foundation과 Package Boundary처럼 사용자 화면이 없는 작업만 수평 PR을 허용한다.

### 2.2 사용 시점에 공통 기능을 구현한다

초기 Platform Kernel에는 모든 미래 기능을 넣지 않는다.

Phase 1에서 구현:

```text
Request Context
Problem Details
Error Code
UUIDv7
UTC Clock
Transaction Runner
기본 Audit Write
Pino Logging
Secret Redaction
```

실제 사용 시점으로 이동:

```text
Cursor Pagination      → 첫 목록 API
Optimistic Lock        → ContentDraft와 설정 편집
Idempotency Storage    → Deployment Callback와 Publish
Outbox Relay           → Webhook과 예약 작업
Dead Letter UI         → 비동기 Consumer 운영 시점
```

### 2.3 데이터 경계를 Query의 입력으로 강제한다

```text
Workspace 범위 Query
→ workspaceId 필수

Site 범위 Query
→ workspaceId + siteId 필수

Delivery Query
→ apiClientId + siteId 필수
```

Scope 없는 범용 `findAll()` Repository Method는 만들지 않는다.

### 2.4 편집본과 이력과 공개본을 분리한다

```text
ContentDraft
└─ Mutable Autosave Working Copy

ContentRevision
└─ Immutable Checkpoint

ContentPublication
└─ Immutable Site별 공개 Snapshot
```

Autosave는 `ContentDraft`만 수정한다. 수동 저장, READY 전환, 게시 직전에 명시적으로 Revision을 만든다.

### 2.5 실행보다 조회를 먼저 구현한다

```text
Deployment Read Model
├─ Release
├─ Deployment
├─ Event
└─ Health

Deployment Control
├─ Workflow Trigger
├─ Redeploy
├─ Lock
└─ Rollback
```

초기 관리자 패널은 상태 수집과 조회부터 제공한다. 원격 실행과 Rollback은 재인증, Allowlist와 Audit가 준비된 이후에만 제공한다.

### 2.6 각 Phase는 독립적으로 배포 가능해야 한다

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Schema 변경이 있으면 Migration Up 검증이 추가되고, 운영 데이터에 영향을 주면 호환성과 복구 절차를 함께 검증한다.

---

## 3. 전체 Phase

| Phase | 이름 | 상태 | 핵심 결과 |
| ---: | --- | --- | --- |
| 0 | Repository Foundation | 완료 | Monorepo, CI, Docker, PostgreSQL, Redis, MinIO |
| 1 | Server Boundary & Platform Kernel Lite | 다음 | API·Worker 공유 코드 경계와 최소 공통 기반 |
| 2 | Admin Identity & Shell | 예정 | OWNER 로그인, MFA, Session, 기본 관리자 Shell |
| 3 | Workspace, Site & API Client | 예정 | 다중 Site와 Site별 Server-to-server 인증 |
| 4 | Project & Deployment Read Model | 예정 | 프로젝트 이력과 CI 배포 상태 조회 |
| 5 | Resource & Member Directory MVP | 예정 | 개인 자료와 Site별 기본 회원 관리 |
| 6 | Content Draft & Revision | 예정 | Autosave Draft와 불변 Revision |
| 7 | Publication & Delivery API | 예정 | Site별 게시와 외부 읽기 API |
| 8 | MinIO Media | 예정 | 원본 Upload, Variant와 Asset Picker |
| 9 | Outbox, Webhook & Scheduling | 예정 | 신뢰성 있는 비동기 처리와 예약 게시 |
| 10 | Content Operations | 예정 | Taxonomy, Redirect, Navigation, Feed와 Search |
| 11 | Deployment Control & Incident | 예정 | 제한된 재배포·Rollback과 장애 관리 |
| 12 | Member Authentication & Privacy | 예정 | 회원가입, 로그인, Consent, 탈퇴와 익명화 |
| 13 | Dashboard & Notification | 예정 | 조치 중심 Dashboard와 알림 |
| 14 | Production Release | 예정 | 운영 보안, Backup, DR, 관측성과 main 배포 |

의존 관계:

```text
Phase 0 Repository Foundation
  ↓
Phase 1 Server Boundary / Kernel Lite
  ↓
Phase 2 Admin Identity / Shell
  ↓
Phase 3 Workspace / Site / API Client
  ├─→ Phase 4 Project / Deployment Read
  │     ↓
  ├─→ Phase 5 Resource / Member Directory
  │
  └─→ Phase 6 Content Draft / Revision
          ↓
        Phase 7 Publication / Delivery
          ↓
        Phase 8 MinIO Media
          ↓
        Phase 9 Outbox / Webhook / Scheduling
          ↓
        Phase 10 Content Operations

Phase 4 → Phase 11 Deployment Control / Incident
Phase 5 → Phase 12 Member Authentication / Privacy
전체 Query와 Event → Phase 13 Dashboard / Notification
전체 기능과 운영 Gate → Phase 14 Production Release
```

---

## 4. Phase별 결과와 경계

## Phase 0. Repository Foundation

### 현재 완료

```text
pnpm Workspace
Turborepo
apps/admin-web
apps/api
apps/worker
PostgreSQL
Redis
MinIO
Docker Compose
Nginx
TypeORM Migration CLI
Object Storage Adapter 골격
Health Check
GitHub Actions CI
```

### 남은 정리

- [ ] macOS와 Ubuntu에서 `scripts/bootstrap.sh` 검증
- [ ] CI에 `docker compose config` 추가
- [ ] Config Schema와 `.env.example` 일치 Test
- [ ] Integration Test용 Database 격리 방식 확정
- [ ] Dependency Update 정책 문서화

### 완료 기준

새 환경에서 README 순서만으로 인프라와 세 애플리케이션을 실행할 수 있다.

---

## Phase 1. Server Boundary & Platform Kernel Lite

### 결과

`apps/api`와 `apps/worker`가 같은 Domain과 Application 코드를 안전하게 공유한다. 이후 모든 기능은 같은 오류, Transaction, Context와 Audit 규칙을 사용한다.

### 범위

```text
packages/server
├─ core
└─ modules

apps/api
├─ HTTP Bootstrap
├─ Controller / DTO
└─ OpenAPI

apps/worker
├─ Queue Bootstrap
├─ Processor
└─ Scheduler
```

구현 항목:

- [ ] `packages/server` 생성
- [ ] `RequestContext`를 `AsyncLocalStorage` 기반으로 구현
- [ ] `application/problem+json` 전역 오류 계약
- [ ] 공통 Error Code Registry
- [ ] UUIDv7과 UTC Clock Port
- [ ] TypeORM Transaction Runner
- [ ] 보안·관리 명령용 최소 `AuditService`
- [ ] Pino Request Logging과 Secret Redaction
- [ ] TypeORM Entity Scan 경로를 `packages/server` 기준으로 변경
- [ ] API와 Worker Build Reference 정리

이번 Phase에서 제외:

```text
범용 Pagination Framework
Outbox Relay
Dead Letter UI
전체 Idempotency Interceptor
동적 RBAC 편집 기능
```

### 완료 기준

샘플 Transaction Command가 DB 변경, Audit 기록과 공통 응답을 생성하고 API와 Worker가 같은 Server Package를 Build할 수 있다.

---

## Phase 2. Admin Identity & Shell

### 결과

OWNER가 Password와 TOTP로 로그인하고 관리자 Shell에 접근한다.

### 초기 모델

```text
AdminAccount
AdminSession
AdminMfaMethod
AdminRecoveryCode
LoginAttempt
ReauthToken
```

초기에는 Role 편집 UI를 만들지 않는다. `OWNER`, `ADMIN`, `EDITOR`, `OPERATOR`, `VIEWER` Role Enum과 Permission Registry를 코드로 관리한다.

### 핵심 기능

- [ ] Interactive OWNER Bootstrap CLI
- [ ] Argon2id Password Hash
- [ ] TOTP 등록과 검증
- [ ] Recovery Code
- [ ] Server-side Session과 Token Digest
- [ ] Synchronizer CSRF Token
- [ ] Idle Timeout과 Absolute Timeout
- [ ] Login Rate Limit과 Lock 정책
- [ ] 위험 작업 Reauthentication
- [ ] Login·MFA·Session Audit
- [ ] Login, MFA, Recovery 화면
- [ ] Sidebar, Topbar, Session 화면

### Security Gate A

관리자 주소를 외부에 노출하기 전에 다음을 완료한다.

```text
TLS
Secure / HttpOnly / SameSite Cookie
CSRF
Login Rate Limit
기본 CSP와 Security Header
Admin Cookie와 Site Domain 분리
```

### 완료 기준

미인증 Admin API는 401, 권한 부족은 403을 반환하며 로그인과 Session 변경이 Audit에 남는다.

---

## Phase 3. Workspace, Site & API Client

### 결과

단일 기본 Workspace 안에서 여러 Site를 등록하고 Site별 Delivery Client를 발급한다.

### 초기 범위

```text
Workspace
├─ Bootstrap된 기본 Workspace 한 개
└─ 다중 Workspace UI는 보류

Site
├─ BLOG
├─ PORTFOLIO
├─ DOCS
├─ PHOTO
└─ OTHER
```

### 핵심 기능

- [ ] Workspace 조회와 기본 설정
- [ ] Site CRUD와 상태 전이
- [ ] Canonical Domain과 Domain Verification 상태
- [ ] Site Timezone, Locale, Branding, SEO Default
- [ ] Site Switcher
- [ ] API Client 생성, 회전, 폐기와 만료
- [ ] API Client Scope와 Site Access
- [ ] HMAC-SHA-256 기반 Secret Digest
- [ ] Site별 Delivery 인증 Guard
- [ ] 첫 Cursor Pagination과 Filter 규칙

### 완료 기준

`main-blog`와 `dev-log`를 생성하고, `main-blog` Key로 `dev-log` API를 호출하면 403을 반환한다.

---

## Phase 4. Project & Deployment Read Model

### 결과

실제 프로젝트 이력과 CI/CD 배포 상태를 관리자 패널에서 조회한다. 이 단계에서는 원격 실행을 제공하지 않는다.

### 핵심 모델

```text
Project
ProjectEvent
RepositoryConnection
Release
Environment
Service
ServiceEnvironment
Deployment
DeploymentEvent
HealthCheck
```

### 핵심 기능

- [ ] Project CRUD와 Timeline
- [ ] Repository, Release와 Site 연결
- [ ] CI 전용 API Client Scope
- [ ] Deployment 시작·Event·완료 Callback
- [ ] `Idempotency-Key` 저장과 중복 응답
- [ ] 환경별 현재 Release
- [ ] Deployment 상태와 Health 상태 분리
- [ ] ServiceEnvironment에 사전 등록된 Health URL만 사용
- [ ] Deployment 목록, 상세와 Timeline 화면

### 완료 기준

CI가 같은 `Idempotency-Key`로 두 번 요청해도 Deployment는 하나만 생성되며, 배포 성공과 Health 실패를 별도로 표시한다.

---

## Phase 5. Resource & Member Directory MVP

### 결과

Atlas를 개인 운영 패널로 실제 사용하기 위한 자료실과 회원 관리의 얇은 버전을 제공한다.

### Resource 범위

```text
ResourceCollection
Resource
ResourceTag
ResourceRelation
ResourceAsset
```

- [ ] Markdown 메모와 문서
- [ ] 외부 Link
- [ ] Collection과 Tag
- [ ] Project·Content 연결을 위한 Relation 골격
- [ ] Visibility와 Sensitivity
- [ ] Archive
- [ ] Secret 입력 경고와 Secret Store Reference

### Member Directory 범위

```text
Member
SiteMembership
MemberAdminNote
```

- [ ] 수동 생성 또는 외부 Import를 위한 기본 API
- [ ] 전체·Site별 회원 목록
- [ ] `PENDING`, `ACTIVE`, `SUSPENDED`, `WITHDRAWN`
- [ ] Site별 상태 변경
- [ ] 관리자 메모

회원 Password, Session, Email Verification은 Phase 12에서 구현한다.

### Data Gate B

실제 개인 자료나 회원 데이터를 넣기 전에 다음을 완료한다.

```text
PostgreSQL Backup Job
최소 1회 Restore Test
MinIO Backup 경로 확정
Backup Secret 분리
삭제와 보존 정책 문서화
```

### 완료 기준

프로젝트에 개인 자료를 연결하고 동일 Member를 Site별로 서로 다른 상태로 관리할 수 있다.

---

## Phase 6. Content Draft & Revision

### 결과

Markdown 글을 Autosave하면서 명시적인 불변 Revision을 생성하고 복구할 수 있다.

### 모델

```text
Content
ContentDraft
ContentRevision
ContentRelation
```

### 규칙

```text
Autosave
→ ContentDraft UPDATE with version

수동 Checkpoint 또는 READY
→ ContentRevision INSERT

과거 Revision 복구
→ ContentDraft에 복사
→ 다음 저장 시 새 Revision 생성
```

### 핵심 기능

- [ ] POST Content 생성
- [ ] Draft Autosave와 Optimistic Lock
- [ ] Local Recovery
- [ ] Markdown Source Editor와 Server Preview
- [ ] Revision Checkpoint
- [ ] READY Validation
- [ ] Revision 목록, Diff용 데이터와 Restore
- [ ] Markdown Sanitization
- [ ] 다른 Workspace 접근 차단

### 완료 기준

Autosave는 Revision을 무한 생성하지 않으며, READY 전환 시 불변 Revision이 생성된다.

---

## Phase 7. Publication & Delivery API

### 결과

하나의 Content를 여러 Site에 배치하고 Site별 게시본을 Delivery API로 제공한다.

### 모델

```text
ContentSite
└─ Site별 route, slug, override와 visibility만 보유

ContentPublication
└─ 게시 상태의 단일 Source of Truth

PublicationAttempt
└─ 게시 검증과 실패 기록
```

`ContentSite.activePublicationId`와 중복 게시 상태 컬럼은 사용하지 않는다. `ACTIVE` Partial Unique Index로 Site 배치당 활성 게시본 하나를 보장한다.

### 핵심 기능

- [ ] Site Assignment
- [ ] Site별 slug, route, 제목·요약·SEO Override
- [ ] Publish Validation
- [ ] 불변 Publication Snapshot
- [ ] ACTIVE, SUPERSEDED, WITHDRAWN, FAILED
- [ ] Publish Idempotency
- [ ] ETag와 `304 Not Modified`
- [ ] Cursor Pagination과 Cache-Control
- [ ] 공개 DTO Version 고정
- [ ] 내부 Entity와 MinIO 정보 미노출

### Delivery API MVP

```http
GET /api/delivery/v1/sites/{siteKey}
GET /api/delivery/v1/sites/{siteKey}/posts
GET /api/delivery/v1/sites/{siteKey}/posts/{slug}
```

### Public Delivery Gate C

```text
Site Key 격리 Test
API Key 회전·폐기 Test
Rate Limit
Cache Header 검증
비공개 Metadata 노출 Test
Nginx/API Security Header
```

### 완료 기준

새 Draft와 Revision을 작성해도 기존 공개 응답은 유지되고, 재게시 후에만 새 Publication과 ETag가 반환된다.

---

## Phase 8. MinIO Media

### 결과

원본을 Private Bucket에 저장하고 가공된 Variant만 외부 Site에 제공한다.

### 핵심 모델

```text
Asset
AssetVariant
AssetUsage
UploadSession
AssetProcessingAttempt
```

### 핵심 기능

- [ ] `atlas-private`, `atlas-processing`, `atlas-public`
- [ ] API와 Worker Service Account 분리
- [ ] Presigned PUT와 Multipart Upload
- [ ] MIME, 크기, Checksum과 실제 Decode 검증
- [ ] 미완료 Multipart 정리
- [ ] WebP·AVIF Variant
- [ ] EXIF 위치 정보 제거
- [ ] Decode Bomb 제한
- [ ] SVG·HTML 기본 차단
- [ ] `asset://{assetId}`
- [ ] Asset Picker와 Cover Image
- [ ] ACTIVE Publication 사용 중 삭제 차단
- [ ] Public Bucket은 `GetObject`만 허용하고 `ListBucket` 금지
- [ ] MinIO API는 직접 인터넷에 노출하지 않고 Nginx가 GET/HEAD만 전달

### 완료 기준

Delivery API와 공개 Asset URL에 내부 Endpoint, Bucket과 Object Key가 노출되지 않는다.

---

## Phase 9. Outbox, Webhook & Scheduling

### 결과

DB Transaction 이후의 부작용을 At-least-once로 처리하되 결과는 Idempotent하게 한 번만 반영한다.

### 전달 규칙

```text
Business Transaction
├─ Domain 변경
└─ OutboxEvent INSERT
        ↓
Outbox Relay
├─ FOR UPDATE SKIP LOCKED
├─ BullMQ enqueue, jobId = eventId
└─ dispatchedAt 기록
        ↓
Consumer
├─ Event 중복 확인
├─ 부작용 실행
└─ Consumer Receipt 저장
```

### 핵심 모델

```text
OutboxEvent
EventConsumption
WebhookEndpoint
WebhookDelivery
PublicationSchedule
```

### 핵심 기능

- [ ] Relay Claim과 Crash Recovery
- [ ] Retry Backoff와 Dead 상태
- [ ] HMAC Webhook
- [ ] Site별 구독 Event
- [ ] 수동 재전송
- [ ] 별도 PublicationSchedule
- [ ] Site Timezone 입력과 UTC 저장
- [ ] 조건부 UPDATE와 Unique Constraint 기반 중복 방지

### 완료 기준

Job은 중복 실행될 수 있지만 같은 Event의 Webhook과 Publication 활성화 결과는 중복 반영되지 않는다.

---

## Phase 10. Content Operations

### 결과

여러 Site가 Delivery API만으로 일반적인 블로그 화면을 구성할 수 있다.

### 범위

- [ ] Site별 Category와 Tag
- [ ] Slug 변경 이력과 Redirect
- [ ] 301, 302, 410 정책
- [ ] Broken Link 검사
- [ ] Navigation과 Home Curation
- [ ] Featured Content
- [ ] RSS, JSON Feed와 Sitemap
- [ ] PostgreSQL Full Text Search
- [ ] OpenGraph와 JSON-LD 데이터
- [ ] Revision Diff UI
- [ ] Internal Link Autocomplete

### 완료 기준

외부 Site가 Home, 목록, 상세, 분류, Feed, Sitemap과 Search를 Atlas API로 구성할 수 있다.

---

## Phase 11. Deployment Control & Incident

### 결과

Phase 4의 Read Model 위에 제한된 운영 명령과 장애 기록을 추가한다.

### 핵심 모델

```text
DeploymentCommand
DeploymentLock
Incident
IncidentEvent
```

### 핵심 기능

- [ ] Allowlist 기반 Workflow Trigger
- [ ] Redeploy
- [ ] Maintenance Metadata
- [ ] Rollback 요청과 결과 기록
- [ ] Production Lock
- [ ] 위험 작업 Reauthentication
- [ ] 대상, 환경, Release SHA 재확인
- [ ] 실행 결과 Audit
- [ ] Incident와 Deployment 연결

금지:

```text
브라우저에서 Docker Socket 접근
임의 Shell Command
Client가 전달한 임의 Health URL 호출
DB Down Migration 자동 실행
```

### Control Gate E

운영 명령을 활성화하기 전에 Reauthentication, Allowlist, Lock, Audit, Dry-run과 Rollback Runbook을 검증한다.

### 완료 기준

허용된 Project와 Environment에 대해서만 명령을 실행하고 모든 요청과 결과가 Audit와 Incident Timeline에 남는다.

---

## Phase 12. Member Authentication & Privacy

### 결과

외부 Site가 회원가입과 로그인을 사용할 수 있고 개인정보 Lifecycle을 관리한다.

### 모델

```text
MemberIdentity
MemberSession
MemberConsent
EmailVerificationToken
PasswordResetToken
MemberExportJob
MemberAnonymizationJob
```

### 핵심 기능

- [ ] 회원가입과 Email Verification
- [ ] Argon2id Password Hash
- [ ] Member Session과 Admin Session 완전 분리
- [ ] Site Membership 생성
- [ ] 동일 이메일 연결은 검증 완료 후 수행
- [ ] Site별 정지와 Global Suspension 정책
- [ ] Consent Version
- [ ] Password Reset
- [ ] 회원 데이터 Export
- [ ] 탈퇴와 익명화
- [ ] 회원 정보 조회 Audit

### Privacy Gate D

개인정보 최소 수집, Consent, Export, 탈퇴, 보존 기간과 익명화가 검증되기 전에는 회원 인증 기능을 외부에 활성화하지 않는다.

### 완료 기준

한 Member가 여러 Site에 가입하고 Site별 상태와 Consent를 독립적으로 관리할 수 있다.

---

## Phase 13. Dashboard & Notification

### 결과

로그인 직후 조치가 필요한 항목을 확인한다.

### Widget

```text
Draft와 READY Content
예약 Publication
Webhook 실패
Media 실패
최근 Deployment
실패 Deployment
비정상 Service
활성 Incident
Backup 상태
MinIO 사용량
최근 관리자 작업
```

### 핵심 기능

- [ ] Notification과 Severity
- [ ] Deduplication Key
- [ ] 읽음·미읽음
- [ ] Target Link
- [ ] 실패 Event 기반 알림
- [ ] Quick Action
- [ ] Command Palette
- [ ] 전역 Search

### 완료 기준

실패 작업과 운영 조치를 Dashboard에서 상세 화면으로 바로 이동해 처리할 수 있다.

---

## Phase 14. Production Release

### 결과

`develop → main → Tag → Production` 흐름으로 안전하게 배포하고 복구한다.

이 Phase는 기본 보안을 처음 추가하는 단계가 아니다. 각 Security Gate에서 이미 적용한 설정을 운영 환경에서 종합 검증한다.

### 핵심 기능

- [ ] `main` Branch Protection과 Required CI
- [ ] Container SHA Tag
- [ ] SBOM과 Vulnerability Scan
- [ ] Migration Precheck
- [ ] LAB 자동 배포
- [ ] Production 수동 승인
- [ ] Health Check와 Deployment Callback
- [ ] 이전 Image Rollback
- [ ] PostgreSQL Backup과 Restore Drill
- [ ] MinIO Mirror와 Versioning 복구 Drill
- [ ] Redis 초기화 후 Worker 복구 검증
- [ ] Prometheus, Loki와 Alert Rule
- [ ] Queue Depth, Outbox Lag와 Webhook Failure Metric
- [ ] Container Non-root와 Secret Scan
- [ ] Disaster Recovery Runbook

### 완료 기준

운영 배포, 이전 Image Rollback, PostgreSQL Restore와 MinIO Object 복구를 재현할 수 있다.

---

## 5. Milestone

## Milestone A. Secure Admin

```text
Phase 0 ~ 3
```

```text
OWNER Login
MFA
Admin Shell
Site
API Client
```

## Milestone B. Personal Operations MVP

```text
Phase 4 ~ 5
```

```text
Project
Deployment Read Model
Resource Library
Member Directory
```

이 시점부터 Atlas를 실제 개인 관리자 패널로 사용한다.

## Milestone C. Headless CMS MVP

```text
Phase 6 ~ 7
```

```text
ContentDraft
ContentRevision
ContentPublication
Delivery API
```

이 시점부터 별도 블로그 애플리케이션 개발을 시작할 수 있다.

## Milestone D. Operable CMS

```text
Phase 8 ~ 10
```

```text
MinIO Media
Webhook
Scheduled Publication
Taxonomy
Feed
Sitemap
Search
```

## Milestone E. Control and Membership

```text
Phase 11 ~ 13
```

```text
Deployment Control
Incident
Member Authentication
Dashboard
Notification
```

## Production Release

```text
Phase 14
```

---

## 6. 권장 PR 순서

```text
01 refactor/server-package-boundary
02 feat/platform-kernel-lite
03 feat/audit-foundation
04 feat/admin-owner-bootstrap
05 feat/admin-auth-session
06 feat/admin-mfa-reauth
07 feat/admin-shell
08 feat/site-management
09 feat/api-client-management
10 feat/project-management-mvp
11 feat/deployment-callback-read-model
12 feat/resource-library-mvp
13 feat/member-directory-mvp
14 feat/content-draft
15 feat/content-revision
16 feat/content-site-assignment
17 feat/publication-snapshot
18 feat/delivery-post-api
19 test/publication-delivery-e2e
20 feat/minio-upload-session
21 feat/media-variant-worker
22 feat/outbox-relay
23 feat/site-webhook
24 feat/publication-scheduler
```

각 PR은 가능한 한 하나의 사용자 결과를 만든다. Schema만 만들고 사용되지 않은 채 오래 두지 않는다.

---

## 7. 바로 시작할 작업

다음 작업은 Phase 1의 첫 구현 단위다.

```text
1. packages/server 생성
2. apps/api와 apps/worker의 TypeScript Reference 연결
3. TypeORM Entity Scan 대상 변경
4. RequestContext와 Request ID
5. Problem Details Filter와 Error Registry
6. UUIDv7과 Clock Port
7. Transaction Runner
8. AuditLog 최소 Schema와 AuditService
9. Pino Logging과 Redaction
10. 샘플 Transaction Integration Test
```

첫 검증 흐름:

```gherkin
Given API와 Worker가 packages/server를 참조한다
When 샘플 관리 Command를 실행한다
Then 동일 Transaction에서 데이터 변경과 Audit가 저장된다
And 성공 응답에는 requestId가 포함된다
When Domain Error가 발생한다
Then application/problem+json 응답을 반환한다
And Secret 값은 Log와 Audit에 기록되지 않는다
```
