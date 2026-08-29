# Atlas

Atlas는 개인 자료, 프로젝트 이력, 배포 상태, 여러 Site의 콘텐츠와 회원을 한곳에서 관리하는 개인 관리 플랫폼입니다.

관리자 패널을 우선 구축하고, 이후 추가되는 블로그·포트폴리오·문서 사이트는 Atlas의 Delivery API와 Webhook을 통해 게시된 콘텐츠를 제공받습니다.

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
pnpm install

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

pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

## 구현 단계

```text
Repository Foundation
→ Platform Core
→ Admin Identity & Security
→ Workspace & Site
→ API Client
→ Content Core
→ Publication & Delivery MVP
→ MinIO Media
→ Webhook & Scheduling
→ Content Operations
→ Project & Deployment
→ Resource & Member
→ Dashboard
→ Production Hardening
```

현재 Repository Foundation이 구성되어 있으며 다음 구현 대상은 Platform Core와 Admin Identity입니다.

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
- [프로젝트 구조](docs/project-structure.md)
- [로컬 개발 환경](docs/local-development.md)
- [브랜치 전략](docs/branch-strategy.md)
- [인프라 구성](infra/README.md)
