# Atlas 플랫폼 설계

- 문서 상태: Draft v0.2
- 작성일: 2026-08-29
- 우선 구현 대상: 관리자 패널
- Admin Web: Next.js + TypeScript
- Backend: NestJS + TypeScript
- Object Storage: MinIO
- 기본 배포 모델: Modular Monolith + Worker

---

## 1. 제품 정의

Atlas는 개인 자료, 프로젝트 이력, 서비스 배포 상태, 블로그 콘텐츠와 회원을 하나의 관리자 패널에서 관리하는 개인 운영 플랫폼이다.

초기에는 관리자 패널과 API를 먼저 개발한다. 실제 블로그 애플리케이션은 이후 별도 저장소와 별도 배포 단위로 만들며, Atlas의 Delivery API와 Webhook을 사용한다.

```text
Atlas Admin
├─ 개인 자료 관리
├─ 프로젝트 및 프로젝트 이력 관리
├─ 서비스·환경·배포 상태 관리
├─ 블로그 콘텐츠 작성·검수·게시
├─ 다중 블로그 관리
├─ 회원 관리
├─ API Client 및 Webhook 관리
└─ Audit Log

External Site Applications
└─ Atlas Delivery API로 게시된 콘텐츠 조회
```

Atlas는 블로그 화면 자체를 제공하는 서비스가 아니라 다음 역할을 담당한다.

```text
Control Plane
├─ 콘텐츠 제작과 게시 제어
├─ 프로젝트와 운영 정보 관리
├─ 회원과 권한 관리
├─ MinIO 미디어 관리
└─ 외부 애플리케이션용 API 제공
```

---

## 2. 목표와 제외 범위

### 2.1 목표

- 한 관리자 패널에서 여러 블로그와 사이트를 관리한다.
- 동일한 원본 콘텐츠를 하나 이상의 Site에 게시할 수 있다.
- Site마다 slug, route, 제목, 요약, SEO, 분류, 게시 일정과 공개 범위를 다르게 관리한다.
- 편집 중인 콘텐츠와 외부에 제공되는 게시본을 분리한다.
- 외부 Site 애플리케이션은 Atlas 데이터베이스에 직접 접근하지 않는다.
- MinIO를 원본 파일, 처리 중 파일, 공개용 미디어 Variant 저장소로 사용한다.
- 프로젝트, Repository, Release, 배포, Health Check 이력을 연결한다.
- 관리자 계정, 일반 회원, API Client의 인증 경계를 분리한다.
- 모든 변경 작업을 Audit Log로 남긴다.
- 이후 Site가 늘어나도 핵심 Schema와 API 경계를 유지한다.

### 2.2 초기 제외 범위

- 블로그 UI 자체 구현
- 결제와 유료 구독
- 대규모 조직용 SaaS Billing
- 관리자 화면에서 임의 SSH 또는 root 명령 실행
- Secret 원문 저장
- Microservice 단위의 과도한 분리
- Elasticsearch 기반 검색
- 복잡한 승인 결재 Workflow

---

## 3. 핵심 설계 결정

### 3.1 다중 블로그는 `Site`로 표현한다

Atlas에서 블로그, 포트폴리오, 문서 사이트처럼 외부에 콘텐츠를 제공하는 하나의 애플리케이션을 `Site`라고 부른다.

```text
Workspace
└─ Site
   ├─ Domain
   ├─ Delivery API Client
   ├─ Content Assignment
   ├─ Publication
   ├─ Membership
   ├─ Webhook
   └─ Site Setting
```

초기에는 Workspace가 하나이고 OWNER도 한 명이지만 데이터 경계는 처음부터 Workspace 단위로 둔다.

```text
Workspace: orot
├─ Site: main-blog
├─ Site: dev-log
├─ Site: photo-blog
└─ Site: docs
```

Site Type은 다음처럼 확장한다.

```text
BLOG
PORTFOLIO
DOCS
PHOTO
OTHER
```

### 3.2 원본 콘텐츠와 Site 게시 설정을 분리한다

`Content`는 Workspace에 속하는 원본 콘텐츠다. 어느 Site에 어떤 형태로 게시할지는 `ContentSite`에서 결정한다.

```text
Content
├─ 공통 원본 제목과 본문
├─ ContentRevision
└─ 공통 Metadata

ContentSite
├─ 대상 Site
├─ Site별 slug와 route
├─ Site별 제목·요약·SEO Override
├─ Site별 Category와 Tag
├─ Site별 공개 범위
├─ Site별 게시 상태
└─ Site별 예약 시간
```

따라서 하나의 원본 글을 여러 Site에 서로 다른 주소와 표현으로 게시할 수 있다.

```text
Content: NestJS 배포 구조
├─ main-blog
│  ├─ /writing/nestjs-deployment
│  └─ 일반 독자용 제목과 요약
└─ dev-log
   ├─ /posts/nestjs-deployment-internals
   └─ 개발자용 제목과 상세 설명
```

### 3.3 편집본과 외부 게시본을 분리한다

```text
Content
└─ 현재 작업 상태

ContentRevision
└─ 불변 변경 이력

ContentPublication
└─ Site별 불변 공개 Snapshot
```

Delivery API는 `Content`나 최신 `ContentRevision`을 직접 반환하지 않는다. 반드시 `ACTIVE ContentPublication`만 반환한다.

이 구조는 다음을 보장한다.

- 게시 중인 글을 수정해도 기존 공개본 유지
- 게시 또는 Webhook 실패 시 기존 공개본 유지
- Site별 게시본 독립 유지
- 게시 당시 Metadata와 Asset Manifest 보존
- 이전 게시본 복구
- ETag와 Cache 안정성

### 3.4 API 경계를 분리한다

```text
/api/admin/v1
└─ 관리자 패널 전용

/api/delivery/v1
└─ 외부 Site 서버의 게시 콘텐츠 조회

/api/integration/v1
└─ CI/CD, Gitea, 배포 Callback

/api/member/v1
└─ 향후 Site 회원 인증과 내 정보 기능
```

각 API는 인증 방식과 권한 모델을 공유하지 않는다.

### 3.5 MinIO 의존성은 Storage Port 뒤에 둔다

Domain Module이 MinIO SDK를 직접 호출하지 않는다.

```text
Media Application Service
→ ObjectStoragePort
→ MinioObjectStorageAdapter
→ MinIO
```

초기 구현은 MinIO로 고정하지만 Object Key, Bucket 정책과 공개 URL 생성 규칙은 Adapter에 캡슐화한다.

---

## 4. 전체 아키텍처

```mermaid
flowchart LR
    A[Admin Browser] -->|Admin Session| AW[Admin Web / Next.js]
    AW -->|Admin API| API[Atlas API / NestJS]

    B1[Site A / Next.js] -->|Site API Key| API
    B2[Site B / Next.js] -->|Site API Key| API
    CI[Gitea Actions / Deploy Script] -->|Integration API Key| API

    API --> PG[(PostgreSQL)]
    API --> REDIS[(Redis)]
    API --> MINIO[(MinIO)]
    API --> OUTBOX[(Transactional Outbox)]

    REDIS --> WORKER[Atlas Worker / NestJS]
    OUTBOX --> WORKER

    WORKER --> MINIO
    WORKER --> WH1[Site A Revalidation Webhook]
    WORKER --> WH2[Site B Revalidation Webhook]

    PUBLIC[assets.example.dev] -->|GET/HEAD only| MINIO
```

### 4.1 초기 배포 단위

```text
admin-web
└─ Next.js 관리자 화면

api
└─ NestJS HTTP API

worker
└─ NestJS Application Context + BullMQ Consumer

postgres
└─ 영속 데이터

redis
└─ Queue, 분산 Lock, 짧은 Cache

minio
├─ Private 원본
├─ 처리 중 Object
└─ 공개용 Variant
```

API는 초기부터 여러 서비스로 쪼개지 않는다. 하나의 NestJS Modular Monolith로 만들고 Module과 API 경계만 명확히 분리한다.

---

## 5. 기술 스택

### 5.1 Frontend

```text
Next.js
React
TypeScript
App Router
TanStack Query
React Hook Form
Zod
OpenAPI generated client
```

### 5.2 Backend

```text
NestJS
TypeScript
TypeORM
PostgreSQL
Redis
BullMQ
Passport
Argon2id
class-validator / class-transformer
@nestjs/swagger
Pino structured logging
```

### 5.3 Storage와 운영

```text
MinIO
MinIO JavaScript Client
Docker Compose
Nginx
OpenAPI
Prometheus metrics
Loki-compatible structured logs
```

MinIO는 S3-compatible protocol을 제공하지만 Atlas의 저장소 Provider와 운영 기준은 MinIO로 고정한다.

### 5.4 저장소 구조

```text
atlas/
├─ apps/
│  ├─ admin-web/
│  ├─ api/
│  └─ worker/
├─ packages/
│  ├─ contracts/
│  ├─ database/
│  ├─ config/
│  ├─ storage/
│  └─ shared/
├─ docs/
│  ├─ atlas-platform-design.md
│  └─ branch-strategy.md
├─ infra/
│  ├─ compose/
│  ├─ minio/
│  │  ├─ policies/
│  │  └─ bootstrap/
│  ├─ nginx/
│  └─ scripts/
├─ package.json
├─ pnpm-workspace.yaml
└─ turbo.json
```

`apps/api`와 `apps/worker`는 같은 Domain Module, Database Package와 Storage Package를 재사용하되 실행 Entry Point는 분리한다.

---

## 6. NestJS Module 구조

```text
apps/api/src
├─ main.ts
├─ app.module.ts
├─ interfaces/
│  ├─ admin-api/
│  ├─ delivery-api/
│  ├─ integration-api/
│  └─ member-api/
├─ modules/
│  ├─ identity/
│  ├─ workspace/
│  ├─ site/
│  ├─ content/
│  ├─ publication/
│  ├─ media/
│  ├─ project/
│  ├─ deployment/
│  ├─ member/
│  ├─ integration/
│  ├─ webhook/
│  ├─ audit/
│  ├─ outbox/
│  └─ search/
└─ common/
   ├─ auth/
   ├─ decorators/
   ├─ filters/
   ├─ guards/
   ├─ interceptors/
   ├─ pipes/
   └─ logging/
```

각 Module 내부는 다음 구조를 기본으로 한다.

```text
content/
├─ domain/
│  ├─ entities/
│  ├─ value-objects/
│  ├─ policies/
│  └─ events/
├─ application/
│  ├─ commands/
│  ├─ queries/
│  └─ services/
├─ infrastructure/
│  ├─ persistence/
│  └─ adapters/
└─ presentation/
   ├─ controllers/
   └─ dto/
```

의존성 규칙:

```text
Controller
→ Application Service
→ Domain Policy
→ Repository or Port Interface
→ TypeORM or MinIO Adapter
```

Controller에서 TypeORM Repository 또는 MinIO Client를 직접 사용하지 않는다.

### 6.1 Storage Port 예시

```ts
export interface ObjectStoragePort {
  createPresignedUpload(input: CreateUploadInput): Promise<PresignedUpload>;
  statObject(bucket: string, objectKey: string): Promise<ObjectMetadata>;
  getObject(bucket: string, objectKey: string): Promise<NodeJS.ReadableStream>;
  putObject(input: PutObjectInput): Promise<void>;
  removeObject(bucket: string, objectKey: string): Promise<void>;
  copyObject(input: CopyObjectInput): Promise<void>;
}
```

MinIO 관련 Endpoint, Bucket, Credential과 URL 생성은 `MinioObjectStorageAdapter`와 Config Module 안에서만 다룬다.

---

## 7. Workspace와 Site 모델

### 7.1 Workspace

```text
workspaces
- id UUIDv7 PK
- key varchar UNIQUE
- name varchar
- status enum
- timezone varchar
- default_locale varchar
- created_at timestamptz
- updated_at timestamptz
```

초기 데이터:

```text
Workspace
- key: orot
- owner: orot
```

### 7.2 Site

```text
sites
- id UUIDv7 PK
- workspace_id FK
- key varchar
- name varchar
- description text
- status enum
- site_type enum
- default_locale varchar
- timezone varchar
- canonical_domain_id nullable
- project_id nullable
- delivery_mode enum
- created_at timestamptz
- updated_at timestamptz
```

제약:

```text
UNIQUE(workspace_id, key)
```

상태:

```text
DRAFT
ACTIVE
MAINTENANCE
DISABLED
ARCHIVED
```

### 7.3 Site Domain

```text
site_domains
- id UUIDv7 PK
- site_id FK
- hostname varchar UNIQUE
- is_canonical boolean
- verification_status enum
- verified_at timestamptz nullable
- created_at timestamptz
```

한 Site는 여러 Domain을 가질 수 있지만 Canonical Domain은 하나만 가진다.

### 7.4 Site Setting

```text
site_settings
- id UUIDv7 PK
- site_id FK
- setting_key varchar
- value_json jsonb
- version integer
- updated_by FK
- updated_at timestamptz
```

제약:

```text
UNIQUE(site_id, setting_key)
```

예시 설정:

```text
branding
navigation
seo-defaults
feed
member-features
content-types
webhook-policy
asset-base-url
```

---

## 8. 인증과 권한

### 8.1 인증 주체 분리

```text
AdminAccount
└─ 관리자 패널 사용자

Member
└─ 외부 Site 일반 회원

ApiClient
└─ Site 서버, CI, 외부 시스템

SystemActor
└─ Worker와 예약 작업
```

관리자와 회원을 같은 테이블에 저장하지 않는다.

### 8.2 관리자 인증

관리자 패널은 Server-side Session을 사용한다.

```text
POST /api/admin/v1/auth/login
→ Password 검증
→ TOTP 또는 Passkey 검증
→ Session 생성
→ HttpOnly Cookie 발급
```

쿠키 정책:

```text
HttpOnly
Secure
SameSite=Strict
Path=/
관리자 전용 Domain
```

초기 보안 요구:

- Argon2id Password Hash
- TOTP MFA
- Recovery Code
- Login Rate Limit
- Session 목록 조회와 개별 폐기
- 위험 작업 Reauthentication
- CSRF 방어
- 로그인과 권한 변경 Audit

### 8.3 관리자 역할

```text
OWNER
ADMIN
EDITOR
OPERATOR
VIEWER
```

Permission 예시:

```text
workspace.read
workspace.manage
site.read
site.manage
content.read
content.write
content.publish
media.read
media.write
project.read
project.write
deployment.read
deployment.execute
member.read
member.manage
api-client.manage
audit.read
```

모든 조회는 `workspaceId`를 기준으로 제한하고 Site 범위 권한이 있으면 `siteId`까지 제한한다.

### 8.4 Delivery API 인증

외부 Site는 Server-to-server API Key를 사용한다.

```http
Authorization: Bearer atlas_live_{keyId}.{secret}
```

API Key 원문은 생성 직후 한 번만 보여주고 DB에는 Hash만 저장한다.

```text
api_clients
- id
- workspace_id
- name
- client_type
- status
- last_used_at
- created_at

api_client_keys
- id
- api_client_id
- key_prefix
- secret_hash
- expires_at
- revoked_at
- created_at

api_client_scopes
- api_client_id
- scope

api_client_site_access
- api_client_id
- site_id
```

Delivery Client Scope:

```text
content:read
feed:read
site:read
```

CI Client Scope:

```text
deployment:create
deployment:update
release:write
health:write
```

Site용 Key와 CI용 Key를 공유하지 않는다. API Key는 브라우저 Bundle에 포함하지 않고 Site의 Server Component, Route Handler 또는 BFF에서만 사용한다.

### 8.5 Webhook 인증

Atlas가 Site에 Webhook을 보낼 때 HMAC SHA-256 서명을 사용한다.

```http
X-Atlas-Event-Id: evt_...
X-Atlas-Timestamp: 1787988000
X-Atlas-Signature: sha256=...
```

서명 대상:

```text
{timestamp}.{rawBody}
```

수신 측은 Timestamp 허용 범위와 Event ID 중복 여부를 검증한다.

---

## 9. 콘텐츠 모델

### 9.1 Content

`Content`는 Site에 직접 종속되지 않는 Workspace 원본이다.

```text
contents
- id UUIDv7 PK
- workspace_id FK
- content_type enum
- format enum
- locale varchar
- title varchar
- summary text
- current_revision_id nullable
- editorial_status enum
- version integer
- created_by FK
- updated_by FK
- created_at timestamptz
- updated_at timestamptz
- archived_at timestamptz nullable
```

초기 Content Type:

```text
POST
PAGE
PROJECT
RESUME
PRIVATE_DOCUMENT
```

향후:

```text
NOTE
LOG
BOOKMARK
SNIPPET
PHOTO
ALBUM
COLLECTION
RUNBOOK
CHANGELOG
```

편집 상태:

```text
DRAFT
READY
ARCHIVED
```

`READY`는 게시 가능 검증이 완료된 상태이지 외부 게시 상태가 아니다.

### 9.2 Content Revision

```text
content_revisions
- id UUIDv7 PK
- content_id FK
- revision_number integer
- title varchar
- summary text
- body_markdown text
- body_html text nullable
- metadata_json jsonb
- content_hash varchar
- change_note text nullable
- created_by FK
- created_at timestamptz
```

제약:

```text
UNIQUE(content_id, revision_number)
UNIQUE(content_id, content_hash)
```

Revision은 생성 후 수정하지 않는다.

### 9.3 Content Site Assignment

```text
content_sites
- id UUIDv7 PK
- content_id FK
- site_id FK
- slug varchar
- route varchar
- title_override varchar nullable
- summary_override text nullable
- seo_title varchar nullable
- seo_description text nullable
- canonical_url varchar nullable
- visibility enum
- publication_status enum
- scheduled_at timestamptz nullable
- active_publication_id nullable
- version integer
- created_at timestamptz
- updated_at timestamptz
```

제약:

```text
UNIQUE(content_id, site_id)
UNIQUE(site_id, route)
```

공개 범위:

```text
PUBLIC
UNLISTED
MEMBERS_ONLY
PRIVATE
```

게시 상태:

```text
UNPUBLISHED
SCHEDULED
ACTIVE
WITHDRAWN
FAILED
```

### 9.4 Publication Snapshot

```text
content_publications
- id UUIDv7 PK
- workspace_id FK
- site_id FK
- content_id FK
- content_site_id FK
- revision_id FK
- publication_number integer
- state enum
- slug varchar
- route varchar
- title varchar
- summary text
- source_markdown text
- rendered_html text
- render_data jsonb
- seo_json jsonb
- taxonomy_json jsonb
- asset_manifest_json jsonb
- content_hash varchar
- etag varchar
- published_by nullable
- published_at timestamptz
- superseded_at timestamptz nullable
- withdrawn_at timestamptz nullable
- created_at timestamptz
```

Publication 상태:

```text
PENDING
ACTIVE
DEGRADED
FAILED
SUPERSEDED
WITHDRAWN
```

동일 `content_site_id`에는 ACTIVE Publication이 최대 하나만 존재하도록 Partial Unique Index를 적용한다.

```sql
CREATE UNIQUE INDEX uq_content_publication_active
ON content_publications (content_site_id)
WHERE state = 'ACTIVE';
```

### 9.5 Taxonomy

Category와 Tag는 Site 단위로 관리한다.

```text
taxonomy_terms
- id
- site_id
- type CATEGORY | TAG
- key
- name
- slug
- description
- parent_id nullable
- sort_order

content_site_terms
- content_site_id
- term_id
```

제약:

```text
UNIQUE(site_id, type, key)
UNIQUE(site_id, type, slug)
```

### 9.6 Content Relation

```text
content_relations
- id
- source_content_id
- target_content_id
- relation_type
- sort_order
- metadata_json
```

관계 예시:

```text
RELATED
PART_OF
REFERENCES
IMPLEMENTS
DOCUMENTS
SHOWCASES
RELEASE_OF
```

---

## 10. 게시 상태와 흐름

### 10.1 상태 전이

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> READY: 검증 완료
    READY --> DRAFT: 편집 재개
    READY --> SCHEDULED: Site별 예약 게시
    READY --> ACTIVE: Site별 즉시 게시
    SCHEDULED --> ACTIVE: 예약 시간 도달
    ACTIVE --> ACTIVE: 새 Revision 재게시
    ACTIVE --> WITHDRAWN: 게시 중단
    WITHDRAWN --> ACTIVE: 재게시
    DRAFT --> ARCHIVED
    READY --> ARCHIVED
```

편집 상태와 Site 게시 상태는 별도로 관리한다.

### 10.2 게시 처리

```mermaid
sequenceDiagram
    participant U as Admin
    participant A as Admin API
    participant D as PostgreSQL
    participant Q as Outbox/BullMQ
    participant W as Worker
    participant B as Site

    U->>A: Publish(contentId, siteId, revisionId)
    A->>A: 권한·Revision·Slug·Asset 검증
    A->>D: Transaction 시작
    A->>D: Publication Snapshot 생성
    A->>D: 이전 ACTIVE를 SUPERSEDED 처리
    A->>D: 새 Publication을 ACTIVE 처리
    A->>D: Outbox Event와 Audit 기록
    A->>D: Commit
    A-->>U: Publication ID 반환
    Q->>W: content.published
    W->>B: Revalidation Webhook
    W->>D: Webhook 결과 기록
```

### 10.3 게시 검증

게시 전 다음 조건을 검사한다.

- Content 상태가 `READY`
- 대상 Revision 존재
- Site가 `ACTIVE`
- slug와 route 충돌 없음
- 필수 Metadata 유효
- Markdown 파싱 성공
- 허용되지 않은 HTML 또는 MDX Component 없음
- 참조 Asset 존재
- 처리 중 또는 실패한 Asset 없음
- Private 원본이 공개 응답에 직접 포함되지 않음
- 내부 링크 대상 유효
- Site별 SEO 규칙 유효

### 10.4 게시 실패

Snapshot 생성 전 실패:

```text
새 Publication 생성 안 함
기존 ACTIVE 유지
Admin에 검증 오류 반환
```

Webhook 또는 Revalidation 실패:

```text
새 Publication은 ACTIVE 유지
Delivery API는 정상 제공
WebhookDelivery를 FAILED로 기록
재시도 Queue 등록
관리자 Dashboard에 경고 표시
```

Site Revalidation 실패를 콘텐츠 게시 실패와 동일하게 취급하지 않는다. Atlas Delivery API가 정상 제공하면 게시 데이터 자체는 유효하다.

---

## 11. MinIO 미디어 설계

### 11.1 기본 원칙

- 저장소 Provider는 MinIO로 고정한다.
- MinIO Root Credential은 Bootstrap에만 사용하고 애플리케이션에는 제공하지 않는다.
- API, Worker, Backup은 각각 별도 MinIO Service Account와 최소 권한 Policy를 사용한다.
- 원본은 항상 Private Bucket에 저장한다.
- 처리 중 Object와 공개 Variant를 별도 Bucket으로 분리한다.
- 본문에는 MinIO URL이나 Object Key 대신 `asset://{assetId}`를 저장한다.
- Publication 생성 시 `asset://` 참조를 공개 Asset URL 또는 Render Data로 변환한다.
- MinIO Console 포트는 외부 인터넷에 공개하지 않는다.
- Delivery API에서 Bucket 이름, 내부 Endpoint, Object Key를 노출하지 않는다.

### 11.2 Bucket 구조

초기부터 접근 목적에 따라 Bucket을 분리한다.

```text
atlas-private
└─ workspaces/{workspaceId}/assets/{assetId}/original/{safeFilename}

atlas-processing
└─ workspaces/{workspaceId}/assets/{assetId}/jobs/{jobId}/...

atlas-public
└─ assets/{assetId}/{contentHash}/{variant}.{ext}
```

Bucket 정책:

| Bucket | API | Worker | 외부 익명 접근 |
|---|---:|---:|---:|
| `atlas-private` | 업로드·조회 검증 | 읽기 | 차단 |
| `atlas-processing` | 제한 | 읽기·쓰기·삭제 | 차단 |
| `atlas-public` | Metadata 조회 | 읽기·쓰기·삭제 | Nginx 경유 GET/HEAD만 |

`atlas-public`을 MinIO Endpoint로 직접 공개하지 않고 `assets.example.dev`를 통해 제공한다.

### 11.3 Endpoint 분리

```text
Internal MinIO API
└─ http://minio:9000

MinIO Console
└─ http://minio:9001
   └─ 내부망 또는 관리자 VPN만 허용

Admin Upload Endpoint
└─ https://upload.example.dev
   └─ Nginx → MinIO API

Public Asset Endpoint
└─ https://assets.example.dev
   └─ Nginx → atlas-public GET/HEAD
```

API와 Worker의 일반 Object 작업은 Internal Endpoint를 사용한다. 브라우저용 Presigned Upload는 브라우저가 접근 가능한 Upload Endpoint를 기준으로 생성한다.

서명 URL의 Host와 실제 요청 Host가 달라지지 않도록 Server용 Client와 Presign용 Client를 분리할 수 있다.

```text
MinioInternalClient
└─ http://minio:9000

MinioPresignClient
└─ https://upload.example.dev
```

### 11.4 환경 변수

```text
MINIO_INTERNAL_ENDPOINT=http://minio:9000
MINIO_PRESIGN_ENDPOINT=https://upload.example.dev
MINIO_USE_SSL=false
MINIO_PRESIGN_USE_SSL=true
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET_PRIVATE=atlas-private
MINIO_BUCKET_PROCESSING=atlas-processing
MINIO_BUCKET_PUBLIC=atlas-public
ASSET_PUBLIC_BASE_URL=https://assets.example.dev
```

Credential은 환경 Secret 또는 별도 Secret Store에서 주입하고 DB와 로그에 저장하지 않는다.

### 11.5 Upload 흐름

```mermaid
sequenceDiagram
    participant U as Admin Web
    participant A as Atlas API
    participant M as MinIO
    participant W as Worker
    participant D as PostgreSQL

    U->>A: Upload Session 생성
    A->>D: UploadSession 저장
    A-->>U: Presigned PUT URL 반환
    U->>M: atlas-private에 원본 직접 업로드
    U->>A: Upload Complete
    A->>M: statObject 검증
    A->>D: Asset 상태 UPLOADED
    A->>W: media.process Queue
    W->>M: 원본 읽기
    W->>W: EXIF 제거·Resize·Format 변환
    W->>M: atlas-public에 Variant 저장
    W->>D: Asset READY
```

Upload Session 생성 시 다음을 고정한다.

- 허용 MIME Type
- 최대 크기
- Object Key
- 만료 시각
- 예상 Checksum
- Workspace와 생성자

완료 API는 Client가 보낸 Metadata를 신뢰하지 않고 MinIO `statObject` 결과와 실제 Checksum을 검증한다.

### 11.6 Asset 모델

```text
assets
- id UUIDv7 PK
- workspace_id FK
- kind enum
- original_filename varchar
- mime_type varchar
- size_bytes bigint
- checksum_sha256 varchar
- width integer nullable
- height integer nullable
- storage_provider varchar DEFAULT MINIO
- private_bucket varchar
- original_object_key varchar
- status enum
- visibility enum
- alt_text text nullable
- caption text nullable
- created_by FK
- created_at timestamptz
- updated_at timestamptz

asset_variants
- id UUIDv7 PK
- asset_id FK
- variant_key varchar
- format varchar
- width integer nullable
- height integer nullable
- size_bytes bigint
- checksum_sha256 varchar
- public_bucket varchar
- object_key varchar
- public_path varchar
- status enum
- created_at timestamptz

asset_usages
- id
- asset_id
- owner_type
- owner_id
- field_name
- created_at

upload_sessions
- id
- workspace_id
- asset_id nullable
- bucket
- object_key
- expected_mime_type
- expected_size
- expected_checksum nullable
- status
- expires_at
- created_by
- created_at
```

Asset 상태:

```text
PENDING_UPLOAD
UPLOADED
PROCESSING
READY
FAILED
QUARANTINED
DELETED
```

Variant 예시:

```text
thumbnail-320-webp
card-768-webp
content-1280-webp
content-1920-avif
original-sanitized
```

### 11.7 다중 Site Asset 사용

Asset은 Workspace에 속하므로 여러 Site에서 재사용할 수 있다. 실제 공개 여부는 `ACTIVE Publication.asset_manifest_json`이 결정한다.

한 Asset을 사용 중인 ACTIVE Publication이 하나라도 있으면 공개 Variant를 삭제하지 않는다.

```text
ACTIVE 사용 있음
→ 유지

ACTIVE 사용 없음 + 보존 기간 이내
→ 유지

ACTIVE 사용 없음 + 보존 기간 만료
→ Garbage Collection 후보
```

### 11.8 공개 및 회원 전용 Asset

`PUBLIC` Publication에서 사용하는 Variant는 `assets.example.dev`의 안정적인 URL을 반환한다.

`MEMBERS_ONLY` 콘텐츠는 공개 Bucket URL을 그대로 반환하지 않는다. 이후 회원 기능 구현 시 다음 중 하나를 사용한다.

```text
짧은 만료의 Presigned GET
또는
인증된 Asset Proxy
```

### 11.9 Backup과 복구

- `atlas-private`과 `atlas-public` Bucket Versioning을 활성화한다.
- MinIO 데이터 디렉터리 Snapshot만으로 복구 정책을 끝내지 않는다.
- `mc mirror` 또는 동등한 Job으로 Synology/NAS의 별도 경로에 주기적으로 복제한다.
- DB Backup과 MinIO Backup의 시점을 Deployment Record에 함께 기록한다.
- 삭제 작업은 Soft Delete와 보존 기간을 거친 뒤 실행한다.
- 복구 Runbook에 Bucket, Version ID, DB Asset Record 복구 순서를 포함한다.

---

## 12. Delivery API

### 12.1 Site 식별

기본 API는 Path에 `siteKey`를 명시한다.

```http
GET /api/delivery/v1/sites/{siteKey}/posts
```

API Client가 접근 가능한 Site인지 Guard에서 검사한다. 향후 Domain Resolver를 추가해도 외부 계약은 `siteKey` 기반을 유지한다.

### 12.2 Endpoint

```http
GET /api/delivery/v1/sites/{siteKey}
GET /api/delivery/v1/sites/{siteKey}/home
GET /api/delivery/v1/sites/{siteKey}/posts
GET /api/delivery/v1/sites/{siteKey}/posts/{slug}
GET /api/delivery/v1/sites/{siteKey}/pages/{slug}
GET /api/delivery/v1/sites/{siteKey}/categories
GET /api/delivery/v1/sites/{siteKey}/tags
GET /api/delivery/v1/sites/{siteKey}/archive
GET /api/delivery/v1/sites/{siteKey}/feed
GET /api/delivery/v1/sites/{siteKey}/sitemap
```

Delivery API는 다음 조건을 모두 만족하는 Publication만 반환한다.

```text
Site.status = ACTIVE
ContentPublication.state = ACTIVE
ContentSite.visibility가 요청 정책에 부합
ApiClient가 Site 접근 권한 보유
```

### 12.3 목록 요청

```http
GET /api/delivery/v1/sites/main-blog/posts?limit=20&cursor=...
Authorization: Bearer atlas_live_keyId.secret
```

```json
{
  "data": [
    {
      "id": "0198f2ca-f061-7c99-996d-8ff56d92ef61",
      "publicationId": "0198f3d0-85df-7cc1-bab1-4cb724b93f21",
      "slug": "atlas-platform-design",
      "title": "Atlas 플랫폼 설계",
      "summary": "개인 관리 플랫폼과 다중 Site Delivery API 설계",
      "cover": {
        "url": "https://assets.example.dev/assets/.../card-768.webp",
        "alt": "Atlas architecture"
      },
      "publishedAt": "2026-08-29T07:00:00Z",
      "updatedAt": "2026-08-29T07:00:00Z"
    }
  ],
  "meta": {
    "nextCursor": "eyJwdWJsaXNoZWRBdCI6Li4ufQ",
    "hasNext": true
  }
}
```

### 12.4 상세 요청과 Cache

```http
GET /api/delivery/v1/sites/main-blog/posts/atlas-platform-design
Authorization: Bearer atlas_live_keyId.secret
If-None-Match: "pub_0198f3d0"
```

```http
ETag: "pub_0198f3d0"
Cache-Control: public, max-age=60, stale-while-revalidate=300
```

변경되지 않았으면 `304 Not Modified`를 반환한다.

### 12.5 응답 원칙

- DB Entity를 그대로 직렬화하지 않는다.
- Delivery DTO는 Version별 계약으로 고정한다.
- 내부 ID와 공개 ID 노출 정책을 구분한다.
- 비공개 Metadata, MinIO 내부 Endpoint, Bucket과 Object Key를 반환하지 않는다.
- Cursor Pagination을 사용한다.
- 정렬과 Filter는 Allowlist로 제한한다.

---

## 13. Admin API

### 13.1 인증

```http
POST   /api/admin/v1/auth/login
POST   /api/admin/v1/auth/mfa/verify
POST   /api/admin/v1/auth/logout
GET    /api/admin/v1/auth/session
POST   /api/admin/v1/auth/reauth
GET    /api/admin/v1/auth/sessions
DELETE /api/admin/v1/auth/sessions/{sessionId}
```

### 13.2 Site

```http
GET    /api/admin/v1/sites
POST   /api/admin/v1/sites
GET    /api/admin/v1/sites/{siteId}
PATCH  /api/admin/v1/sites/{siteId}
POST   /api/admin/v1/sites/{siteId}/activate
POST   /api/admin/v1/sites/{siteId}/disable
GET    /api/admin/v1/sites/{siteId}/domains
POST   /api/admin/v1/sites/{siteId}/domains
GET    /api/admin/v1/sites/{siteId}/settings
PATCH  /api/admin/v1/sites/{siteId}/settings/{key}
```

### 13.3 Content

```http
GET    /api/admin/v1/contents
POST   /api/admin/v1/contents
GET    /api/admin/v1/contents/{contentId}
PATCH  /api/admin/v1/contents/{contentId}
POST   /api/admin/v1/contents/{contentId}/ready
POST   /api/admin/v1/contents/{contentId}/draft
POST   /api/admin/v1/contents/{contentId}/archive

GET    /api/admin/v1/contents/{contentId}/revisions
POST   /api/admin/v1/contents/{contentId}/revisions
GET    /api/admin/v1/contents/{contentId}/revisions/{revisionId}
POST   /api/admin/v1/contents/{contentId}/revisions/{revisionId}/restore
```

### 13.4 Site 배치와 게시

```http
GET    /api/admin/v1/contents/{contentId}/sites
POST   /api/admin/v1/contents/{contentId}/sites
PATCH  /api/admin/v1/content-sites/{contentSiteId}
DELETE /api/admin/v1/content-sites/{contentSiteId}

POST   /api/admin/v1/content-sites/{contentSiteId}/schedule
POST   /api/admin/v1/content-sites/{contentSiteId}/publish
POST   /api/admin/v1/content-sites/{contentSiteId}/unpublish
GET    /api/admin/v1/content-sites/{contentSiteId}/publications
GET    /api/admin/v1/content-sites/{contentSiteId}/validation
POST   /api/admin/v1/content-sites/{contentSiteId}/preview-token
```

게시 요청:

```json
{
  "revisionId": "0198f3d0-85df-7cc1-bab1-4cb724b93f21",
  "publishAt": null,
  "changeNote": "초기 게시"
}
```

### 13.5 Media

```http
POST   /api/admin/v1/assets/upload-sessions
POST   /api/admin/v1/assets/upload-sessions/{sessionId}/complete
GET    /api/admin/v1/assets
GET    /api/admin/v1/assets/{assetId}
PATCH  /api/admin/v1/assets/{assetId}
DELETE /api/admin/v1/assets/{assetId}
GET    /api/admin/v1/assets/{assetId}/usages
POST   /api/admin/v1/assets/{assetId}/regenerate
```

---

## 14. 프로젝트와 배포

### 14.1 프로젝트 모델

```text
projects
- id
- workspace_id
- key
- name
- summary
- description
- status
- visibility
- started_at
- completed_at nullable
- created_at
- updated_at

project_events
- id
- project_id
- event_type
- title
- description
- occurred_at
- metadata_json
- created_by

repositories
- id
- project_id
- provider
- owner
- name
- url
- default_branch
- visibility

releases
- id
- project_id
- version
- tag
- commit_sha
- branch
- release_notes
- released_at
```

프로젝트 상태:

```text
IDEA
PLANNING
ACTIVE
MAINTENANCE
PAUSED
COMPLETED
ARCHIVED
```

Site는 필요할 때 `project_id`로 프로젝트와 연결한다.

### 14.2 서비스와 환경

```text
services
- id
- project_id
- key
- name
- service_type
- status

service_environments
- id
- service_id
- environment_id
- base_url
- health_check_url
- current_release_id nullable
- current_deployment_id nullable

environments
- id
- workspace_id
- key
- name
- type LAB | STAGING | PRODUCTION
- status
```

### 14.3 배포

```text
deployments
- id
- service_environment_id
- release_id
- external_deployment_id
- status
- trigger_type
- triggered_by_type
- triggered_by_id
- started_at
- finished_at nullable
- rollback_of nullable
- workflow_url nullable
- log_url nullable
- error_code nullable
- error_message nullable
- metadata_json

deployment_events
- id
- deployment_id
- sequence
- event_type
- message
- metadata_json
- occurred_at

health_checks
- id
- service_environment_id
- deployment_id nullable
- status
- status_code nullable
- latency_ms nullable
- checked_at
- detail_json
```

배포 상태:

```text
QUEUED
RUNNING
SUCCEEDED
FAILED
CANCELED
ROLLED_BACK
```

서비스 상태:

```text
HEALTHY
DEGRADED
DOWN
UNKNOWN
```

배포 성공과 서비스 Health는 분리한다.

### 14.4 Integration API

```http
POST /api/integration/v1/deployments
POST /api/integration/v1/deployments/{deploymentId}/events
POST /api/integration/v1/deployments/{deploymentId}/complete
POST /api/integration/v1/health-checks
POST /api/integration/v1/releases
```

```http
Idempotency-Key: {projectKey}-{environmentKey}-{workflowRunId}
```

동일 Key 요청은 새로운 Deployment를 중복 생성하지 않는다.

---

## 15. 개인 자료 관리

개인 자료는 Workspace 범위의 `Resource`로 관리하고 필요할 때 Content 또는 Project와 연결한다.

```text
resource_collections
- id
- workspace_id
- parent_id nullable
- name
- description
- sort_order

resources
- id
- workspace_id
- collection_id nullable
- resource_type
- title
- summary
- body_markdown
- source_url nullable
- visibility
- sensitivity
- metadata_json
- created_by
- created_at
- updated_at

resource_assets
- resource_id
- asset_id

resource_relations
- resource_id
- target_type
- target_id
- relation_type
```

Resource Type:

```text
NOTE
DOCUMENT
LINK
REFERENCE
CHECKLIST
SNIPPET
```

공개 범위:

```text
PRIVATE
MEMBER
PUBLIC_CANDIDATE
```

`PUBLIC_CANDIDATE`는 공개 가능한 자료라는 의미일 뿐 Delivery API에 자동 노출하지 않는다. 반드시 Content로 변환하고 Site Publication을 생성해야 외부에 노출된다.

비밀번호, Private Key와 Token은 저장하지 않는다. Secret Store의 Reference만 저장한다.

---

## 16. 회원 관리

### 16.1 다중 Site 회원 구조

회원 Identity는 Workspace에서 공유하고 Site별 상태와 역할은 Membership으로 분리한다.

```text
Member
└─ SiteMembership
   ├─ main-blog ACTIVE
   └─ dev-log SUSPENDED
```

이를 통해 한 이메일로 여러 Site에 가입할 수 있고 Site별 정지와 권한을 독립 관리할 수 있다.

### 16.2 데이터 모델

```text
members
- id
- workspace_id
- email
- display_name
- global_status
- email_verified_at nullable
- last_login_at nullable
- created_at
- updated_at
- deleted_at nullable

member_identities
- id
- member_id
- provider
- provider_subject nullable
- password_hash nullable
- created_at

site_memberships
- id
- site_id
- member_id
- status
- role
- joined_at
- suspended_at nullable
- withdrawn_at nullable
- metadata_json

member_sessions
- id
- member_id
- token_hash
- ip_hash
- user_agent
- expires_at
- revoked_at nullable
- created_at

member_consents
- id
- member_id
- site_id nullable
- consent_type
- document_version
- agreed_at
- revoked_at nullable
```

회원 상태:

```text
INVITED
PENDING
ACTIVE
SUSPENDED
WITHDRAWN
```

관리자 기능:

- Workspace 및 Site 기준 회원 검색
- 가입 Site와 상태 확인
- 활성화·정지·탈퇴
- Session 강제 종료
- 동의 이력 확인
- 관리자 메모
- 회원 데이터 Export
- 탈퇴 개인정보 익명화

블로그 회원가입과 로그인 UI는 이후 구현하지만 관리자 데이터 모델과 Admin API는 선행할 수 있다.

---

## 17. Event, Queue와 Webhook

### 17.1 Transactional Outbox

DB 변경과 Event 발행의 불일치를 막기 위해 Outbox Pattern을 사용한다.

```text
outbox_events
- id
- workspace_id
- site_id nullable
- aggregate_type
- aggregate_id
- event_type
- payload_json
- status
- available_at
- processed_at nullable
- attempt_count
- last_error nullable
- created_at
```

상태:

```text
PENDING
PROCESSING
PROCESSED
FAILED
```

### 17.2 주요 Event

```text
content.created
content.revision.created
content.ready
content.published
content.unpublished
content.slug.changed
media.uploaded
media.ready
site.activated
member.joined
member.suspended
release.created
deployment.started
deployment.completed
deployment.failed
```

모든 Event Payload에는 다음 값이 포함된다.

```text
eventId
occurredAt
workspaceId
siteId nullable
aggregateId
schemaVersion
```

### 17.3 Site별 Webhook

```text
webhook_endpoints
- id
- site_id
- name
- url
- status
- secret_ciphertext
- subscribed_events
- created_at
- updated_at

webhook_deliveries
- id
- endpoint_id
- event_id
- attempt_number
- status
- request_body
- response_status nullable
- response_body_excerpt nullable
- error_message nullable
- requested_at
- completed_at nullable
- next_retry_at nullable
```

재시도 예시:

```text
1분
5분
30분
2시간
12시간
```

동일 Event는 `X-Atlas-Event-Id`로 중복 처리할 수 있게 한다.

---

## 18. API 공통 규약

### 18.1 식별자와 시간

```text
ID: UUIDv7
시간 저장: UTC timestamptz
API 시간: ISO-8601 UTC
Site 표시 시간: Site timezone 변환
```

### 18.2 성공 응답

```json
{
  "data": {},
  "meta": {
    "requestId": "req_01...",
    "timestamp": "2026-08-29T07:00:00Z"
  }
}
```

### 18.3 오류 응답

`application/problem+json`을 사용한다.

```json
{
  "type": "https://atlas.example/problems/content-not-ready",
  "title": "Content is not ready",
  "status": 409,
  "code": "CONTENT_NOT_READY",
  "detail": "READY 상태의 Revision만 게시할 수 있습니다.",
  "requestId": "req_01..."
}
```

공통 오류 코드:

```text
AUTH_REQUIRED
MFA_REQUIRED
REAUTH_REQUIRED
FORBIDDEN
VALIDATION_FAILED
NOT_FOUND
VERSION_CONFLICT
INVALID_STATE_TRANSITION
SITE_NOT_ACCESSIBLE
SLUG_CONFLICT
ASSET_NOT_READY
PUBLISH_VALIDATION_FAILED
DEPLOYMENT_LOCKED
INTEGRATION_UNAVAILABLE
ACTION_NOT_ALLOWED
RATE_LIMITED
IDEMPOTENCY_CONFLICT
STORAGE_UNAVAILABLE
UPLOAD_SESSION_EXPIRED
```

### 18.4 Pagination

```http
GET /api/admin/v1/contents?siteId=...&status=READY&cursor=...&limit=30
```

Cursor Pagination을 기본으로 하고 최대 `limit`을 제한한다.

### 18.5 동시성

수정 요청은 `version` 또는 `If-Match`를 사용한다.

```http
If-Match: "12"
```

서버 Version이 다르면 `409 VERSION_CONFLICT`를 반환한다.

### 18.6 멱등성

게시, 배포 생성, Upload Complete와 Callback 같은 명령은 `Idempotency-Key`를 지원한다.

```text
idempotency_records
- key
- actor_id
- request_hash
- response_status
- response_body
- expires_at
```

---

## 19. Audit와 Logging

### 19.1 Audit Log

```text
audit_logs
- id
- workspace_id
- site_id nullable
- actor_type
- actor_id
- action
- target_type
- target_id
- request_id
- ip_hash
- user_agent
- before_json nullable
- after_json nullable
- result
- occurred_at
```

Actor Type:

```text
ADMIN
MEMBER
API_CLIENT
SYSTEM
```

Audit 대상:

- 관리자 로그인과 실패
- 관리자와 권한 변경
- Site 생성·활성화·비활성화
- API Key 생성·회전·폐기
- Content Revision 생성
- 게시·재게시·게시 중단
- Asset Upload·삭제·복구
- 회원 정지·탈퇴
- Deployment 상태 변경
- Webhook 설정 변경

Password Hash, API Secret, Session Token과 MinIO Credential은 Audit에 기록하지 않는다.

### 19.2 Application Log

```text
requestId
traceId
workspaceId
siteId
actorType
actorId
action
module
latencyMs
statusCode
errorCode
```

Audit Log와 Application Log는 목적과 보존 정책을 분리한다.

---

## 20. 보안 원칙

- Admin Domain과 외부 Site Domain을 분리한다.
- Admin Cookie를 외부 Site Domain과 공유하지 않는다.
- Delivery API Key를 Client-side JavaScript에 포함하지 않는다.
- API Key Secret은 Hash만 저장한다.
- Webhook Secret은 암호화해 저장한다.
- MinIO Root Credential을 애플리케이션에 제공하지 않는다.
- MinIO Console을 인터넷에 노출하지 않는다.
- Private와 Processing Bucket은 익명 접근을 차단한다.
- Public Asset는 Nginx를 통해 GET/HEAD만 허용한다.
- MinIO Object Key와 내부 Bucket 이름을 Delivery API에서 숨긴다.
- Presigned Upload의 MIME, 크기와 만료 시간을 제한한다.
- SVG, HTML과 실행 파일 업로드 정책을 별도로 둔다.
- 이미지 EXIF 위치 정보를 제거한다.
- 관리자 변경 API는 CSRF와 Reauthentication을 적용한다.
- 회원 개인정보 조회와 변경을 Audit에 기록한다.
- Raw SQL 또는 Repository 조회에서 `workspaceId`와 `siteId` 누락을 방지한다.
- 자유 명령 실행과 Docker Socket 접근을 Web Admin에 제공하지 않는다.
- Secret 원문을 프로젝트 자료나 배포 Metadata에 저장하지 않는다.

---

## 21. 관리자 화면 정보 구조

```text
Dashboard

콘텐츠
├─ 전체 콘텐츠
├─ 초안
├─ 게시 준비
├─ 예약 게시
├─ Site별 게시 현황
├─ Publication 이력
├─ 카테고리와 태그
└─ 미디어

Sites
├─ Site 목록
├─ Domain
├─ Navigation
├─ SEO Default
├─ Delivery API Client
├─ Webhook
└─ 설정

프로젝트
├─ 프로젝트 목록
├─ 프로젝트 Timeline
├─ Repository
├─ Release
└─ 관련 자료

운영
├─ 서비스
├─ 환경
├─ 배포 현황
├─ 배포 이력
├─ Health Check
└─ 장애 기록

자료실
├─ 문서
├─ 메모
├─ 링크
├─ 첨부파일
├─ 컬렉션
└─ 전체 검색

회원
├─ 전체 회원
├─ Site별 회원
├─ 회원 상세
├─ 상태 관리
├─ 활성 Session
└─ 동의 이력

시스템
├─ 관리자 계정
├─ 역할과 권한
├─ API Client
├─ Webhook Delivery
├─ MinIO 상태와 사용량
├─ Audit Log
└─ 시스템 설정
```

전역 상단에는 현재 Workspace와 Site Filter를 둔다.

```text
Workspace: orot
Site: All Sites | main-blog | dev-log | photo-blog
```

---

## 22. 배포 토폴로지

초기 구성:

```text
Internet
  ↓
Nginx
  ├─ admin.example.dev
  │   └─ admin-web
  ├─ api.example.dev
  │   └─ api
  ├─ upload.example.dev
  │   └─ MinIO API for Presigned Upload
  └─ assets.example.dev
      └─ atlas-public GET/HEAD

Application Network
├─ api
├─ worker
├─ postgres
├─ redis
└─ minio
   ├─ API :9000
   └─ Console :9001, internal only
```

외부 Site는 별도 배포한다.

```text
blog-a.example.dev
└─ Site A
   ├─ Delivery API Client A
   └─ Revalidation Webhook A

blog-b.example.dev
└─ Site B
   ├─ Delivery API Client B
   └─ Revalidation Webhook B
```

Atlas 장애 시 Site가 마지막 렌더링 결과를 계속 제공하도록 Site 측 Cache와 ISR 정책을 적용한다.

```text
Atlas API 장애
├─ Site 기존 Cache 제공
└─ 새 콘텐츠 조회와 Revalidation만 지연

MinIO 장애
├─ Site가 캐시한 기존 이미지 제공 가능
├─ 신규 Upload와 Variant 생성 중단
└─ Atlas에서 Storage 상태를 DEGRADED로 표시
```

---

## 23. 구현 단계

기간이 아니라 동작 가능한 수직 기능 단위로 나눈다.

### Phase 0. Repository Foundation

목표:

```text
Monorepo와 develop 중심 개발·테스트 기준을 만든다.
```

작업:

- pnpm Workspace
- Turbo 또는 동등한 Task Runner
- `admin-web`, `api`, `worker` 생성
- TypeScript 공통 설정
- ESLint와 Formatter
- Docker Compose
- PostgreSQL, Redis와 MinIO
- MinIO Bucket 및 Policy Bootstrap
- TypeORM Migration
- OpenAPI 생성
- Request ID와 Logging
- Health Endpoint

완료 기준:

- 전체 앱 Local 실행
- Migration 실행
- MinIO Bucket Bootstrap 재실행 가능
- Admin Web에서 API와 Storage Health 확인
- CI에서 lint, typecheck, test, build 통과

### Phase 1. Admin Foundation

목표:

```text
OWNER가 안전하게 로그인하고 관리자 Shell에 진입한다.
```

작업:

- Workspace Bootstrap
- Owner Bootstrap
- Password Hash
- TOTP MFA
- Session
- CSRF
- Role과 Permission Guard
- Audit Interceptor
- Admin Layout
- Sidebar와 Topbar
- Error Boundary
- API Client

완료 기준:

- 관리자 로그인과 로그아웃
- MFA 이후 Dashboard 진입
- 미인증 Admin API 차단
- 로그인과 로그아웃 Audit 기록

### Phase 2. Site와 API Client

목표:

```text
여러 Site를 등록하고 Site별 Delivery Client를 발급한다.
```

작업:

- Site CRUD
- Domain CRUD
- Site Setting
- Site Filter
- API Client와 Key 발급
- Scope와 Site Access
- Key 회전과 폐기
- Delivery API 인증 Guard

완료 기준:

- Site 두 개 생성 가능
- Site별 API Key 발급 가능
- Site A Key로 Site B 조회 불가

### Phase 3. 콘텐츠 수직 흐름

목표:

```text
글을 작성해 특정 Site에 게시하고 Delivery API로 조회한다.
```

작업:

- Content와 Revision
- Markdown Editor
- Autosave
- READY 검증
- ContentSite Assignment
- Site별 slug와 SEO
- Publication Snapshot
- Publish와 Unpublish
- Delivery 목록과 상세 API
- ETag
- Audit
- E2E Test

완료 기준:

```text
Create
→ Revision
→ READY
→ Site 배치
→ Publish
→ Delivery API 조회
```

### Phase 4. MinIO Media

목표:

```text
MinIO에 원본을 안전하게 업로드하고 공개 Variant를 게시한다.
```

작업:

- MinIO Service Account와 Policy
- Private, Processing, Public Bucket
- Upload Session
- Presigned Upload
- statObject와 Checksum 검증
- Asset Library
- BullMQ Media Job
- Thumbnail과 WebP/AVIF
- EXIF 제거
- `asset://id`
- Asset Usage
- Publication Asset Manifest
- Public Asset URL
- Garbage Collection 후보 조회
- Backup Job

완료 기준:

- 원본 직접 Upload
- Variant 자동 생성
- MinIO 원본 URL과 Object Key 미노출
- 게시된 글에서 공개 Variant 사용
- 사용 중인 Variant 삭제 방지

### Phase 5. Webhook과 예약 게시

목표:

```text
Site별 Cache를 자동 갱신한다.
```

작업:

- Transactional Outbox
- BullMQ Worker
- Site Webhook
- HMAC 서명
- Retry와 Dead Letter
- 예약 게시
- Webhook Delivery 화면

완료 기준:

- Site A 게시 시 Site A Webhook만 호출
- 실패 Webhook 자동 재시도
- 동일 Event 중복 처리 방지

### Phase 6. 프로젝트와 배포

목표:

```text
프로젝트, Release, 배포와 Health 상태를 연결한다.
```

작업:

- Project CRUD
- Project Timeline
- Repository와 Release
- Service와 Environment
- Deployment Callback API
- Deployment Event
- Health Check
- Site와 Project 연결
- 배포 Dashboard

완료 기준:

- CI Callback으로 Deployment 생성
- 진행 상태와 이력 표시
- 현재 Site의 운영 Release 확인

### Phase 7. 자료실과 회원

목표:

```text
개인 자료와 다중 Site 회원을 관리한다.
```

작업:

- Resource와 Collection
- Asset 연결
- Project와 Content 관계
- Member Identity
- Site Membership
- 회원 상태 관리
- Session 폐기
- Consent History
- 탈퇴와 익명화

완료 기준:

- 동일 회원의 Site별 상태 독립 관리
- 자료와 프로젝트·콘텐츠 연결

---

## 24. 우선 생성할 Entity

관리자 패널 첫 구현:

```text
Workspace
AdminAccount
Role
Permission
AdminSession
Site
SiteDomain
SiteSetting
ApiClient
ApiClientKey
ApiClientScope
ApiClientSiteAccess
AuditLog
```

콘텐츠 수직 흐름:

```text
Content
ContentRevision
ContentSite
ContentPublication
TaxonomyTerm
ContentSiteTerm
OutboxEvent
```

미디어 단계:

```text
Asset
AssetVariant
AssetUsage
UploadSession
```

---

## 25. 초기 Acceptance Scenario

### 25.1 Site 격리

```gherkin
Given OWNER가 main-blog와 dev-log Site를 생성했다
And main-blog 전용 API Client를 발급했다
When 해당 Client로 main-blog 글 목록을 요청한다
Then main-blog의 ACTIVE Publication만 반환한다
When 같은 Client로 dev-log를 요청한다
Then 403 SITE_NOT_ACCESSIBLE을 반환한다
```

### 25.2 동일 콘텐츠 다중 Site 게시

```gherkin
Given 하나의 Content와 READY Revision이 있다
When main-blog에 slug "atlas-design"으로 게시한다
And dev-log에 slug "atlas-design-internals"로 게시한다
Then 각 Site에 별도의 ACTIVE Publication이 생성된다
And 두 Delivery API는 Site별 slug와 SEO를 반환한다
```

### 25.3 공개 글 수정

```gherkin
Given main-blog에 ACTIVE Publication이 있다
When Content의 새 Revision을 작성한다
Then 기존 Delivery API 응답은 변경되지 않는다
When 새 Revision을 main-blog에 다시 게시한다
Then 새 Publication이 ACTIVE가 된다
And 이전 Publication은 SUPERSEDED가 된다
```

### 25.4 MinIO Upload

```gherkin
Given OWNER가 이미지 Upload Session을 생성했다
When Presigned URL로 atlas-private에 Upload를 완료한다
And Upload Complete API를 호출한다
Then API는 MinIO statObject와 Checksum을 검증한다
And Worker가 atlas-public에 공개용 Variant를 생성한다
And Asset 상태는 READY가 된다
And API 응답에는 내부 Endpoint, Bucket과 Object Key가 포함되지 않는다
```

### 25.5 배포 Callback 멱등성

```gherkin
Given CI가 동일 Idempotency-Key로 Deployment 생성 요청을 두 번 보낸다
When Atlas가 요청을 처리한다
Then 하나의 Deployment만 생성한다
And 두 번째 요청은 최초 응답을 반환한다
```

---

## 26. ADR 요약

### ADR-001. Backend는 NestJS Modular Monolith로 시작한다

- 현재 요구 규모에 Microservice는 과도하다.
- Module과 API 경계는 유지한다.
- Worker를 별도 NestJS Entry Point로 분리한다.
- TypeScript Contract를 공유한다.

### ADR-002. 여러 외부 애플리케이션은 Site로 관리한다

- Domain, 설정, API Client, Webhook과 회원을 독립 관리한다.
- Site 추가 시 핵심 Schema 변경이 필요 없다.
- Site 단위 권한과 Audit가 가능하다.

### ADR-003. Content는 Workspace 원본이고 Publication은 Site별이다

- 동일 콘텐츠 Cross-posting을 지원한다.
- Site별 slug와 SEO를 Override한다.
- Site별 게시 일정과 게시 중단을 지원한다.
- 공개본을 격리하고 복구할 수 있다.

### ADR-004. Object Storage는 MinIO를 사용한다

- 개인 인프라에서 직접 운영할 수 있다.
- Private 원본과 Public Variant를 분리할 수 있다.
- Presigned Direct Upload를 지원한다.
- MinIO SDK 의존성을 Storage Port 뒤에 격리한다.
- Synology/NAS로 Backup 흐름을 구성할 수 있다.

### ADR-005. Delivery API는 Server-to-server API Key를 사용한다

- 관리자 Session과 인증 경계를 분리한다.
- Site별 접근 권한을 제한한다.
- Key 회전과 폐기를 지원한다.
- 향후 OAuth2 Client Credentials로 확장할 수 있다.

### ADR-006. 게시본은 불변 Snapshot이다

- 편집 중 변경 노출을 방지한다.
- 실패 시 기존 공개본을 유지한다.
- ETag와 Cache가 안정적이다.
- Revision 기반 복구가 가능하다.

### ADR-007. 비동기 작업은 Outbox와 BullMQ를 사용한다

- 예약 게시, 이미지 처리와 Webhook 재시도를 처리한다.
- DB Transaction과 Event 유실을 방지한다.

---

## 27. 첫 구현의 기준 흐름

```text
OWNER 로그인
→ Workspace와 Site 생성
→ Site 전용 API Client 발급
→ Content 작성
→ Revision 저장
→ READY 전환
→ Content를 Site에 배치
→ Site별 slug 지정
→ Publish
→ ACTIVE Publication 생성
→ Delivery API Key로 글 조회
→ MinIO Asset Upload와 Variant 생성
→ 새 Revision 작성
→ 기존 공개본 유지 확인
→ Re-publish
→ 새 Publication 반환 확인
```
