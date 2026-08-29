# Atlas

Atlas는 개인 자료, 프로젝트 이력, 배포 상태, 여러 Site의 콘텐츠와 회원을 한곳에서 관리하는 개인 관리 플랫폼입니다.

관리자 패널을 먼저 구축하고 실제 운영 기능을 얇게 완성한 뒤, 별도 블로그·포트폴리오·문서 Site가 Delivery API와 Webhook을 통해 콘텐츠를 제공받도록 확장합니다.

## 기술 구성

- Admin Web: Next.js + TypeScript
- Backend: NestJS + TypeScript
- Database: PostgreSQL + TypeORM
- Queue/Worker: Redis + BullMQ
- Object Storage: MinIO
- Monorepo: pnpm Workspace + Turborepo
- API Contract: OpenAPI
- Local Infrastructure: Docker Compose + Nginx

## 빠른 시작

```bash
git clone https://github.com/orot11955/atlas.git
cd atlas
git switch develop

cp .env.example .env
corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm install --frozen-lockfile

pnpm infra:up
pnpm db:migration:run
pnpm dev
```

또는 Bootstrap Script를 사용합니다.

```bash
./scripts/bootstrap.sh
pnpm dev
```

기본 주소:

```text
Admin Web       http://localhost:3000
API             http://localhost:4000/api
Swagger         http://localhost:4000/api/docs
Health          http://localhost:4000/api/health/ready
MinIO API       http://localhost:9000
MinIO Console   http://localhost:9001
Full Stack      http://localhost:8080
Public Assets   http://localhost:8080/assets/{objectKey}
```

## 주요 명령

```bash
pnpm dev                    # 전체 애플리케이션 개발 모드
pnpm dev:admin              # Admin Web만 실행
pnpm dev:api                # NestJS API만 실행
pnpm dev:worker             # Worker만 실행

pnpm infra:up               # PostgreSQL, Redis, MinIO 시작 및 Bucket 초기화
pnpm infra:down             # 로컬 인프라 종료
pnpm infra:reset            # Volume까지 삭제
pnpm stack:up               # 애플리케이션 포함 전체 Docker Stack 시작
pnpm stack:down             # 전체 Docker Stack 종료

pnpm db:migration:run       # Migration 적용
pnpm db:migration:revert    # 마지막 Migration 되돌리기
pnpm db:migration:show      # Migration 상태 확인

pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

## 수정된 구현 순서

```text
Repository Foundation
→ Server Boundary & Platform Kernel Lite
→ Admin Identity & Shell
→ Workspace, Site & API Client
→ Project & Deployment Read Model
→ Resource & Member Directory MVP
→ Content Draft & Revision
→ Publication & Delivery API
→ MinIO Media
→ Outbox, Webhook & Scheduling
→ Content Operations
→ Deployment Control & Incident
→ Member Authentication & Privacy
→ Dashboard & Notification
→ Production Release
```

현재 Repository Foundation이 구성되어 있으며 다음 구현 대상은 `packages/server` 경계와 Platform Kernel Lite입니다.

## Milestone

```text
Secure Admin
→ Personal Operations MVP
→ Headless CMS MVP
→ Operable CMS
→ Control and Membership
→ Production
```

프로젝트·배포 조회, 개인 자료와 Member Directory를 CMS 고도화보다 앞당겨 관리자 패널의 실사용 시점을 빠르게 만듭니다.

## 브랜치

```text
feature/*
  ↓ Pull Request
develop
  ↓ Release Pull Request
main
  ↓ Tag / Production Deployment
```

- `develop`: 기본 개발 및 통합 브랜치
- `main`: 운영 배포 기준 브랜치

## 문서

- [플랫폼 설계](docs/atlas-platform-design.md)
- [전체 구현 로드맵](docs/implementation-roadmap.md)
- [Phase별 구현 체크리스트](docs/implementation/phase-checklists.md)
- [구현 아키텍처 결정](docs/implementation/architecture-decisions.md)
- [Acceptance와 Release Gate](docs/implementation/acceptance-gates.md)
- [프로젝트 구조](docs/project-structure.md)
- [로컬 개발 환경](docs/local-development.md)
- [브랜치 전략](docs/branch-strategy.md)
- [인프라 구성](infra/README.md)
