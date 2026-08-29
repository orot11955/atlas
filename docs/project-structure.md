# Atlas 프로젝트 구조

- 문서 상태: Draft v0.2
- 기준 브랜치: `develop`
- 전체 순서: [전체 구현 로드맵](implementation-roadmap.md)
- 세부 결정: [구현 아키텍처 결정](implementation/architecture-decisions.md)

## 1. 목표 구조

```text
atlas/
├─ apps/
│  ├─ admin-web/              # Next.js 관리자 화면
│  ├─ api/                    # NestJS HTTP Bootstrap와 Presentation
│  └─ worker/                 # NestJS Worker Bootstrap와 Processor
│
├─ packages/
│  ├─ server/                 # API와 Worker가 공유하는 Server Domain/Application
│  ├─ config/                 # 환경변수 Schema와 공통 Parser
│  ├─ contracts/              # 외부 API 공통 계약과 생성 Client 기반
│  ├─ database/               # TypeORM DataSource와 Migration CLI
│  ├─ object-storage/         # ObjectStorage Port와 MinIO Adapter
│  └─ shared/                 # Framework 독립 공통 함수와 Type
│
├─ infra/
│  ├─ minio/                  # Bucket, Service Account와 Policy 초기화
│  ├─ nginx/                  # Reverse Proxy와 Public Asset Gateway
│  ├─ postgres/               # Database 초기화와 운영 보조 설정
│  └─ scripts/                # Backup, Restore와 Infra 관리 Script
│
├─ docs/
│  ├─ implementation/
│  └─ *.md
├─ scripts/
├─ compose.yml
├─ package.json
├─ pnpm-workspace.yaml
└─ turbo.json
```

현재 Repository Foundation에는 `packages/server`가 아직 없다. Phase 1에서 Domain 코드가 늘어나기 전에 생성하고 TypeORM Entity Scan 경로를 변경한다.

---

## 2. 애플리케이션 책임

## `apps/admin-web`

관리자 전용 Next.js 애플리케이션이다.

```text
apps/admin-web/src
├─ app/
│  ├─ (auth)/
│  └─ admin/
├─ features/
│  ├─ auth/
│  ├─ sites/
│  ├─ projects/
│  ├─ deployments/
│  ├─ resources/
│  ├─ members/
│  ├─ contents/
│  └─ media/
├─ components/
│  ├─ ui/
│  ├─ layout/
│  └─ feedback/
├─ lib/
│  ├─ api/
│  ├─ auth/
│  └─ query/
└─ types/
```

규칙:

- Database와 MinIO에 직접 접근하지 않는다.
- Admin API만 호출한다.
- Server Component에서 관리자 Secret을 직접 다루지 않는다.
- API 오류는 공통 Problem Details Parser를 사용한다.
- Feature 간 직접 import보다 공통 Contract와 Public API를 사용한다.

## `apps/api`

HTTP Transport와 애플리케이션 조립만 담당한다.

```text
apps/api/src
├─ main.ts
├─ app.module.ts
├─ http/
│  ├─ admin/
│  │  ├─ auth/
│  │  ├─ sites/
│  │  ├─ projects/
│  │  ├─ deployments/
│  │  ├─ resources/
│  │  ├─ members/
│  │  ├─ contents/
│  │  └─ media/
│  ├─ delivery/
│  ├─ integration/
│  └─ member/
├─ auth/
│  ├─ guards/
│  ├─ decorators/
│  └─ strategies/
├─ interceptors/
├─ filters/
├─ middleware/
└─ health/
```

API 경계:

```text
/api/admin/v1
/api/delivery/v1
/api/integration/v1
/api/member/v1
/api/health
/api/docs
```

규칙:

- Controller는 TypeORM Repository를 직접 사용하지 않는다.
- Controller는 `packages/server`의 Application Use Case를 호출한다.
- Express Request, Response와 Cookie 처리는 `apps/api`를 벗어나지 않는다.
- 외부 DTO와 Entity를 분리한다.
- OpenAPI는 HTTP DTO를 기준으로 생성한다.

## `apps/worker`

HTTP와 분리해야 하는 비동기 작업을 실행한다.

```text
apps/worker/src
├─ main.ts
├─ worker.module.ts
├─ processors/
│  ├─ outbox/
│  ├─ media/
│  ├─ webhook/
│  ├─ publication/
│  ├─ deployment/
│  └─ member/
├─ schedulers/
└─ health/
```

주요 작업:

```text
Outbox Relay
MinIO 이미지 Variant
Webhook Retry
예약 게시
Deployment Health Check
Member 익명화
Backup 상태 수집
```

규칙:

- BullMQ Job Payload를 Domain 객체로 직접 전달하지 않는다.
- Processor는 Payload를 검증한 뒤 `packages/server` Use Case를 호출한다.
- Processor는 HTTP Controller나 DTO를 import하지 않는다.
- Job은 At-least-once 실행을 전제로 Idempotent하게 구현한다.

---

## 3. Server Package

```text
packages/server/src
├─ core/
│  ├─ request-context/
│  ├─ errors/
│  ├─ ids/
│  ├─ clock/
│  ├─ transaction/
│  ├─ audit/
│  ├─ idempotency/
│  └─ events/
│
├─ modules/
│  ├─ identity/
│  ├─ workspace/
│  ├─ site/
│  ├─ api-client/
│  ├─ project/
│  ├─ deployment/
│  ├─ resource/
│  ├─ member/
│  ├─ content/
│  ├─ publication/
│  ├─ media/
│  ├─ webhook/
│  ├─ taxonomy/
│  └─ notification/
│
└─ index.ts
```

각 Module은 다음 구조를 기본으로 한다.

```text
modules/content/
├─ domain/
│  ├─ entities/
│  ├─ value-objects/
│  ├─ policies/
│  ├─ errors/
│  └─ events/
├─ application/
│  ├─ commands/
│  ├─ queries/
│  ├─ ports/
│  └─ services/
├─ infrastructure/
│  ├─ persistence/
│  │  ├─ entities/
│  │  ├─ repositories/
│  │  └─ mappers/
│  └─ adapters/
└─ content.module.ts
```

Presentation은 `apps/api`에, Queue Processor는 `apps/worker`에 둔다.

의존 방향:

```text
Transport
→ Application
→ Domain

Infrastructure Adapter
→ Application Port

Domain
→ 외부 Framework에 의존하지 않음
```

---

## 4. 공통 패키지 책임

## `packages/config`

- 환경변수 Schema
- API, Worker와 Migration용 Config
- Secret Field 식별
- `.env.example` 일치 Test

## `packages/contracts`

- 외부 API 공통 Response Type
- Problem Details Type
- Cursor Meta
- Event Envelope Contract
- Job Payload Version
- OpenAPI 생성 Client의 안정적인 Export

영속 Entity를 Export하지 않는다.

## `packages/database`

```text
packages/database/src
├─ data-source.ts
├─ migrations/
├─ naming/
└─ test-utils/
```

- TypeORM DataSource
- Migration 생성·적용·되돌리기
- Integration Test Database Helper
- Naming과 Index Helper

Entity Scan 대상:

```text
packages/server/src/**/*.entity.ts
packages/server/dist/**/*.entity.js
```

## `packages/object-storage`

```text
ObjectStoragePort
├─ put
├─ stat
├─ getStream
├─ delete
├─ presignPut
├─ presignGet
└─ multipart

MinioObjectStorageAdapter
└─ MinIO SDK 격리
```

Port에서 MinIO SDK Type을 노출하지 않는다.

## `packages/shared`

- Framework 독립 Type
- 작은 순수 함수
- 문자열과 날짜 Utility
- 공통 Test Fixture 중 Framework 독립 항목

`NestJS`, `Next.js`, `TypeORM`, `BullMQ`에 의존하지 않는다.

---

## 5. Module 구현 순서

```text
server-boundary
  ↓
platform-kernel-lite
  ↓
identity
  ↓
workspace + site + api-client
  ├─→ project + deployment-read
  ├─→ resource + member-directory
  └─→ content-draft + revision
          ↓
        publication + delivery
          ↓
        media
          ↓
        outbox + webhook + scheduler
          ↓
        content-operations

project + deployment-read
→ deployment-control + incident

member-directory
→ member-auth + privacy

전체 Query와 Event
→ dashboard + notification
```

Audit는 초기 Kernel에 최소 Write 기능을 만들고, 조회 화면은 필요한 시점에 추가한다. Outbox Table과 Relay는 실제 비동기 부작용이 시작되는 Phase 9에서 완성한다.

---

## 6. Data Model 배치

Entity와 Repository Adapter:

```text
packages/server/src/modules/{module}/infrastructure/persistence
```

Migration:

```text
packages/database/src/migrations
```

HTTP DTO와 Controller:

```text
apps/api/src/http/{boundary}/{module}
```

Admin Web Feature:

```text
apps/admin-web/src/features/{feature}
```

Worker Processor:

```text
apps/worker/src/processors/{queue}
```

---

## 7. Import 규칙

허용:

```text
apps/api        → packages/server
apps/worker     → packages/server
packages/server → packages/object-storage
packages/server → packages/shared
packages/database → packages/server의 Entity 경로
apps/admin-web  → packages/contracts
```

금지:

```text
apps/worker → apps/api
apps/api → apps/worker
packages/server → apps/api
packages/server → apps/worker
packages/shared → NestJS / TypeORM / Next.js
Domain → MinIO SDK / Express / BullMQ
```

ESLint Boundary Rule 또는 Dependency Cruiser는 Module 수가 늘어나는 시점에 추가한다.

---

## 8. Phase 1 구조 변경 순서

```text
1. packages/server Package 생성
2. Workspace Reference와 Path Alias 추가
3. Core Error와 Clock부터 이동
4. 새 Domain Module은 packages/server에만 생성
5. TypeORM DataSource Entity Glob 변경
6. API와 Worker가 동일 Package를 Build하는 CI 추가
7. 기존 apps/api Infrastructure 중 공유 대상만 점진적으로 이동
```

Health Controller, HTTP Filter와 Cookie Guard는 `apps/api`에 유지한다. BullMQ Processor와 Scheduler는 `apps/worker`에 유지한다.
