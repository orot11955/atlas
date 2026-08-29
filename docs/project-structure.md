# Atlas 프로젝트 구조

## 전체 구조

```text
atlas/
├─ apps/
│  ├─ admin-web/          # Next.js 관리자 화면
│  ├─ api/                # NestJS HTTP API
│  └─ worker/             # NestJS Application Context + BullMQ Worker
│
├─ packages/
│  ├─ config/             # 환경변수 Schema와 공통 Parser
│  ├─ contracts/          # API 공통 DTO와 계약
│  ├─ database/           # TypeORM DataSource와 Migration CLI
│  ├─ object-storage/     # ObjectStorage Port와 MinIO Adapter
│  └─ shared/             # 프레임워크에 독립적인 공통 함수
│
├─ infra/
│  ├─ minio/              # Bucket, 사용자와 Policy 초기화
│  └─ nginx/              # 로컬 Full Stack Reverse Proxy
│
├─ docs/
├─ scripts/
├─ compose.yml
├─ package.json
├─ pnpm-workspace.yaml
└─ turbo.json
```

## 애플리케이션 책임

### `apps/admin-web`

관리자 전용 UI입니다.

- Dashboard
- Site 관리
- 콘텐츠 작성과 게시
- 프로젝트와 배포 상태
- 자료실과 회원
- 시스템 설정

Admin Web은 데이터베이스나 MinIO에 직접 접근하지 않고 Admin API만 호출합니다.

### `apps/api`

HTTP 진입점입니다.

```text
/api/admin/v1
/api/delivery/v1
/api/integration/v1
/api/member/v1
/api/health
/api/docs
```

도메인 기능은 다음 구조로 추가합니다.

```text
modules/{module-name}/
├─ domain/
├─ application/
├─ infrastructure/
└─ presentation/
```

Controller가 TypeORM Repository를 직접 사용하지 않도록 합니다.

```text
Controller
→ Application Service
→ Domain Policy
→ Repository Port
→ TypeORM Adapter
```

### `apps/worker`

HTTP 요청과 분리해야 하는 작업을 처리합니다.

- 예약 게시
- Outbox Event 처리
- MinIO 이미지 Variant 생성
- Webhook 재시도
- 검색 인덱스 갱신
- 배포 상태 동기화

현재는 `atlas-system` Queue의 `heartbeat` Job을 처리하는 최소 Worker가 들어 있습니다.

## 공통 패키지 규칙

- `packages/shared`는 NestJS, Next.js와 TypeORM에 의존하지 않습니다.
- `packages/contracts`에는 영속 Entity를 노출하지 않습니다.
- `packages/object-storage`의 Port는 MinIO SDK 타입을 외부에 노출하지 않습니다.
- `packages/database`는 Migration 실행과 생성의 단일 기준점입니다.
- 패키지 간 순환 의존성을 만들지 않습니다.

## 구현 의존 순서

```text
platform-core
├─ request-context
├─ error-contract
├─ transaction
├─ idempotency
├─ audit foundation
└─ outbox foundation
  ↓
identity
  ↓
workspace
  ↓
site
  ↓
api-client
  ↓
content
  ↓
publication + delivery
  ↓
media
  ↓
webhook + scheduler
  ↓
content-operations
  ↓
project
  ↓
deployment
  ↓
resource
  ↓
member
  ↓
dashboard + notification
  ↓
production-hardening
```

`Audit`와 `Outbox`는 독립된 최종 기능이 아니라 초기 공통 기반으로 먼저 구성합니다. 이후 각 도메인 Event Consumer와 관리자 운영 화면을 단계적으로 추가합니다.

전체 작업과 완료 기준은 [전체 구현 로드맵](implementation-roadmap.md)을 기준으로 합니다.

## Entity와 Migration 위치

각 모듈의 Entity와 Adapter는 다음 위치에 둡니다.

```text
apps/api/src/modules/{module}/infrastructure/persistence
```

Migration은 다음 위치를 단일 기준으로 사용합니다.

```text
packages/database/src/migrations
```

Worker가 API와 동일한 Domain·Application 코드를 사용해야 하는 경우 Module을 공유하되 HTTP Presentation 계층에는 의존하지 않습니다.
