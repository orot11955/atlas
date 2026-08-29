# Atlas 구현 아키텍처 결정

- 문서 상태: Draft v0.1
- 적용 대상: `develop`
- 목적: 구현 로드맵 검토에서 확정한 데이터 모델, 보안, 비동기 처리와 코드 경계를 기록한다.

이 문서는 기존 플랫폼 설계와 충돌하는 항목에 대해 우선한다. 이후 플랫폼 설계 문서를 개정할 때 아래 결정을 본문에 통합한다.

---

## ADR-I001. API와 Worker 공유 코드는 `packages/server`에 둔다

### 문제

Domain과 Application 코드를 `apps/api/src/modules`에 두면 Worker가 API 애플리케이션 내부 코드를 직접 import하게 된다.

```text
apps/worker
→ apps/api 내부 Module
→ HTTP 애플리케이션과 Worker 결합
```

### 결정

```text
apps/api
├─ Bootstrap
├─ HTTP Controller
├─ DTO
├─ Guard / Interceptor
└─ OpenAPI

apps/worker
├─ Worker Bootstrap
├─ BullMQ Processor
└─ Scheduler

packages/server
├─ core
│  ├─ request-context
│  ├─ errors
│  ├─ transaction
│  ├─ audit
│  └─ clock
└─ modules
   ├─ identity
   ├─ workspace
   ├─ site
   ├─ api-client
   ├─ project
   ├─ deployment
   ├─ resource
   ├─ member
   ├─ content
   ├─ publication
   ├─ media
   └─ webhook
```

각 Module은 다음 의존 방향을 지킨다.

```text
HTTP Controller 또는 Queue Processor
→ Application Use Case
→ Domain Policy
→ Repository Port
→ TypeORM Adapter
```

`packages/server`는 NestJS Provider를 사용할 수 있지만 Express, Cookie, HTTP Response와 BullMQ Job 객체를 Domain에 노출하지 않는다.

### TypeORM

DataSource의 Entity Scan 대상은 다음으로 변경한다.

```text
packages/server/src/**/*.entity.ts
packages/server/dist/**/*.entity.js
```

Migration은 계속 다음 위치를 단일 기준으로 사용한다.

```text
packages/database/src/migrations
```

---

## ADR-I002. Autosave는 `ContentDraft`, 이력은 `ContentRevision`이 담당한다

### 문제

Autosave할 때마다 불변 Revision을 생성하면 작성 중인 글 하나에 과도한 Revision이 생긴다. 기존 Revision을 수정하면 불변성 규칙이 깨진다.

### 결정

```text
Content
└─ 식별자, Type, 편집 상태

ContentDraft
└─ 현재 편집 중인 Mutable Working Copy

ContentRevision
└─ 명시적으로 생성되는 Immutable Checkpoint

ContentPublication
└─ Site별 Immutable 공개 Snapshot
```

### 권장 Schema

```text
contents
- id
- workspace_id
- content_type
- editorial_status
- current_revision_id nullable
- created_by
- updated_by
- created_at
- updated_at
- archived_at nullable

content_drafts
- content_id PK/FK
- title
- summary
- body_markdown
- metadata_json
- version
- saved_by
- saved_at

content_revisions
- id
- content_id
- revision_number
- title
- summary
- body_markdown
- metadata_json
- content_hash
- reason
- created_by
- created_at
```

### 동작

```text
입력 중 Autosave
→ content_drafts UPDATE WHERE version = expectedVersion

수동 Checkpoint
→ content_revisions INSERT
→ contents.current_revision_id 갱신

READY 전환
→ Draft 검증
→ 필요하면 새 Revision 생성
→ editorial_status = READY

과거 Revision 복구
→ 선택 Revision을 Draft에 복사
→ 다음 Checkpoint에서 새 Revision 생성
```

Revision은 생성 후 UPDATE하지 않는다.

---

## ADR-I003. 게시 상태의 Source of Truth는 `ContentPublication` 하나다

### 문제

`ContentSite.publicationStatus`, `activePublicationId`, `ContentPublication.state`를 함께 관리하면 상태 불일치가 생길 수 있다.

### 결정

`ContentSite`에는 Site별 배치 설정만 둔다.

```text
content_sites
- id
- content_id
- site_id
- slug
- route
- title_override nullable
- summary_override nullable
- seo_json
- visibility
- version
- created_at
- updated_at
```

게시 상태는 `ContentPublication.state`에서만 판단한다.

```text
PENDING
ACTIVE
SUPERSEDED
WITHDRAWN
FAILED
```

동일 `content_site_id`에는 ACTIVE Publication이 하나만 존재한다.

```sql
CREATE UNIQUE INDEX uq_content_publications_active
ON content_publications (content_site_id)
WHERE state = 'ACTIVE';
```

게시 Transaction:

```text
1. 대상 Revision과 ContentSite 검증
2. 기존 ACTIVE를 SUPERSEDED로 변경
3. 새 Publication INSERT 또는 PENDING 생성 후 ACTIVE 전환
4. Audit 기록
5. 필요 시 OutboxEvent 기록
6. Commit
```

`activePublicationId`는 초기 Schema에 추가하지 않는다. 조회 성능 문제가 실제로 확인되면 Cache 또는 명시적 Projection을 추가한다.

---

## ADR-I004. 예약 게시를 `PublicationSchedule`로 분리한다

### 문제

예약 시간과 실행 상태를 `ContentSite`에 저장하면 여러 예약, 취소, 실패와 재시도 이력을 표현하기 어렵다.

### 결정

```text
publication_schedules
- id
- content_site_id
- revision_id
- scheduled_at
- status
- attempt_count
- last_error nullable
- canceled_at nullable
- executed_at nullable
- created_by
- created_at
```

상태:

```text
SCHEDULED
PROCESSING
COMPLETED
FAILED
CANCELED
```

한 ContentSite에 활성 예약이 하나만 필요하면 Partial Unique Index를 사용한다.

```sql
CREATE UNIQUE INDEX uq_publication_schedule_open
ON publication_schedules (content_site_id)
WHERE status IN ('SCHEDULED', 'PROCESSING');
```

Job은 중복 실행될 수 있다. 조건부 UPDATE와 Publication ACTIVE Unique Index를 통해 결과만 한 번 반영한다.

---

## ADR-I005. Password와 API Key의 Digest 방식을 분리한다

### Password

사람이 선택하는 Password는 Argon2id를 사용한다.

```text
Admin Password
Member Password
복구용 단기 Code 중 낮은 Entropy 값
```

### API Key와 Session Token

API Key는 충분한 무작위 Entropy를 가진 Secret으로 생성한다.

```text
atlas_live_{keyId}.{secret}
```

DB에는 다음을 저장한다.

```text
api_client_keys
- id
- api_client_id
- key_prefix
- secret_digest
- expires_at nullable
- revoked_at nullable
- created_at
```

Digest:

```text
HMAC-SHA-256(API_KEY_PEPPER, secret)
```

검증:

```text
keyId 또는 Prefix로 Candidate 조회
→ 전달된 Secret의 HMAC 계산
→ constant-time 비교
```

Session Token도 원문을 저장하지 않고 SHA-256 또는 HMAC-SHA-256 Digest를 저장한다.

Pepper는 DB가 아니라 환경 Secret 또는 Secret Store에 둔다. Rotation 시 새 Key를 발급하고 기존 Key에 유예 기간을 둘 수 있다.

---

## ADR-I006. Outbox와 BullMQ는 At-least-once + Idempotent Effect를 보장한다

### 전달 흐름

```text
Business Transaction
├─ Aggregate 변경
└─ outbox_events INSERT
        ↓
Outbox Relay
├─ SELECT ... FOR UPDATE SKIP LOCKED
├─ BullMQ add(jobId = eventId)
└─ dispatched_at 기록
        ↓
Consumer
├─ event_consumptions UNIQUE 검사
├─ 부작용 실행
└─ 처리 결과 기록
```

### Outbox Schema

```text
outbox_events
- id
- aggregate_type
- aggregate_id
- event_type
- schema_version
- payload_json
- status
- available_at
- claimed_at nullable
- dispatched_at nullable
- attempt_count
- last_error nullable
- created_at
```

### Consumer Receipt

```text
event_consumptions
- consumer_key
- event_id
- status
- processed_at
- result_json nullable

UNIQUE(consumer_key, event_id)
```

### 보장하지 않는 것

```text
정확히 한 번 Job 실행
외부 시스템의 정확히 한 번 처리
```

### 보장하는 것

```text
Event 유실 최소화
동일 Event 재전달 허용
Atlas 내부 상태의 중복 반영 방지
Webhook Event ID를 통한 수신 측 중복 제거 지원
```

---

## ADR-I007. Audit는 보안·운영 변경을 기록하고 본문 전체를 복사하지 않는다

### Audit 대상

```text
로그인 성공·실패
MFA 변경
Session 폐기
관리자와 권한 변경
API Key 발급·회전·폐기
Site 활성화·비활성화
Content Revision 생성
게시·게시 중단·복구
회원 상태 변경과 개인정보 조회
배포·재배포·Rollback
삭제·복구
```

일반 404, Validation 오류와 단순 조회 실패는 Application Log에 기록한다.

### Content Audit 예시

```json
{
  "action": "content.revision.created",
  "targetId": "content-id",
  "metadata": {
    "revisionId": "revision-id",
    "changedFields": ["title", "body"],
    "contentHash": "sha256:..."
  }
}
```

Markdown 본문, Password Hash, Token, Cookie, MinIO Credential과 회원 민감정보를 `before_json`과 `after_json`에 저장하지 않는다.

DB 연결 실패처럼 Audit 저장 자체를 보장할 수 없는 장애는 Structured Log와 외부 로그 파이프라인으로 남긴다.

---

## ADR-I008. 보안과 Backup은 단계별 Gate로 적용한다

### Gate A: Admin Exposure

Phase 2 완료 전:

```text
TLS
Secure Cookie
CSRF
Login Rate Limit
기본 CSP
Security Header
Admin Domain 분리
```

### Gate B: Real Data Storage

Phase 5에서 실제 자료·회원 데이터를 넣기 전:

```text
PostgreSQL Backup
Restore Test
MinIO Backup 경로
Retention
삭제·복구 정책
```

### Gate C: Public Delivery

Phase 7 공개 API 활성화 전:

```text
Site Access 격리
API Key Rotation
Rate Limit
Cache Header
비공개 Metadata 노출 Test
```

### Gate D: Member Authentication

Phase 12 외부 회원 기능 활성화 전:

```text
Consent Version
Export
탈퇴
익명화
Password Reset 보안
회원 정보 조회 Audit
```

### Gate E: Deployment Control

Phase 11 운영 명령 활성화 전:

```text
Reauthentication
Target Allowlist
Deployment Lock
Audit
Dry-run
Rollback Runbook
```

### Gate F: Production Release

Phase 14:

```text
Required CI
Image SHA
Migration Precheck
Restore Drill
Observability
Disaster Recovery
```

---

## ADR-I009. Deployment Read Model과 Control을 분리한다

### Read Model

Phase 4에서 구현한다.

```text
Project
Release
Deployment
DeploymentEvent
HealthCheck
현재 운영 Version
실패 원인
```

CI가 Callback API로 상태를 전달한다. 이 단계에서는 Atlas가 원격 명령을 실행하지 않는다.

### Control

Phase 11에서 구현한다.

```text
Workflow Trigger
Redeploy
Maintenance Metadata
Deployment Lock
Rollback Request
```

Control API는 Browser에서 직접 외부 인프라에 접근하지 않는다. 허용된 Command와 Target만 Server-side Adapter를 통해 실행한다.

Health Check는 `ServiceEnvironment`에 저장된 URL만 사용한다. Callback Payload가 전달한 임의 URL을 요청하지 않는다.

---

## ADR-I010. Member Directory와 Member Authentication을 분리한다

### Directory MVP

Phase 5:

```text
Member
SiteMembership
MemberAdminNote
회원 목록
Site별 상태
정지·탈퇴 표시
```

### Authentication

Phase 12:

```text
MemberIdentity
Password
Email Verification
MemberSession
Consent
Password Reset
Export
익명화
```

동일 이메일의 Identity 연결은 이메일 검증 완료 후 정책에 따라 수행한다. 검증되지 않은 이메일 문자열만으로 자동 병합하지 않는다.

---

## ADR-I011. MinIO 공개 Asset는 읽기만 허용하고 내부 Endpoint를 노출하지 않는다

### Bucket

```text
atlas-private
└─ 원본

atlas-processing
└─ 변환 중간 결과

atlas-public
└─ 공개 Variant
```

### 공개 정책

```text
atlas-public
├─ GetObject 허용
├─ ListBucket 금지
├─ PutObject 금지
└─ DeleteObject 금지
```

MinIO API Port는 인터넷에 직접 공개하지 않는다. Nginx가 `/assets/*`에 대해 GET과 HEAD만 전달한다.

회원 전용 Asset은 `atlas-public`의 안정 URL을 사용하지 않는다.

```text
짧은 만료 Presigned GET
또는
인증된 Asset Proxy
```

Presigned Upload는 실제 Browser가 접근하는 Host를 기준으로 생성하며 CORS, Multipart Upload와 미완료 Upload 정리 정책을 함께 구성한다.

---

## ADR-I012. Definition of Done은 변경 위험에 따라 적용한다

모든 PR에 모든 Test를 강제하지 않는다.

```text
Schema 변경
→ Migration과 Migration Test

Domain 규칙 변경
→ Unit Test

Repository Query 변경
→ Integration Test

인증·게시·배포·회원 Privacy
→ E2E 또는 Acceptance Test

단순 UI·문서·스타일
→ 관련 Test와 Build
```

공통 필수 항목:

```text
format
lint
typecheck
관련 test
build
문서 또는 OpenAPI 갱신
Secret 노출 없음
```
