# Atlas 로컬 개발 환경

## 1. 요구 사항

```text
Node.js 24 이상
Corepack
pnpm 11
Docker + Docker Compose
Git
```

## 2. 최초 설치

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
```

한 번에 처리하려면 다음 Script를 실행합니다.

```bash
./scripts/bootstrap.sh
```

최초 `pnpm install` 후 생성되는 `pnpm-lock.yaml`은 저장소에 Commit합니다.

## 3. 개발 실행

전체 실행:

```bash
pnpm dev
```

개별 실행:

```bash
pnpm dev:admin
pnpm dev:api
pnpm dev:worker
```

`pnpm dev`는 먼저 공통 패키지를 Build한 뒤 각 Package의 Watch Mode를 실행합니다.

## 4. 로컬 주소

```text
Admin Web        http://localhost:3000
API              http://localhost:4000/api
Swagger          http://localhost:4000/api/docs
Liveness         http://localhost:4000/api/health/live
Readiness        http://localhost:4000/api/health/ready
PostgreSQL       localhost:5432
Redis            localhost:6379
MinIO API        http://localhost:9000
MinIO Console    http://localhost:9001
Docker Full UI   http://localhost:8080
```

## 5. Docker 실행

인프라만 실행하고 Node Application은 Host에서 실행:

```bash
pnpm infra:up
pnpm dev
```

모든 서비스를 Container로 실행:

```bash
pnpm stack:up
pnpm stack:logs
```

종료:

```bash
pnpm stack:down
pnpm infra:down
```

데이터까지 초기화:

```bash
pnpm infra:reset
```

`infra:reset`은 PostgreSQL, Redis와 MinIO Volume을 삭제하므로 로컬 데이터가 모두 제거됩니다.

## 6. Migration

빈 Migration 생성:

```bash
pnpm db:migration:create -- src/migrations/AddWorkspace
```

Entity 변경으로 Migration 생성:

```bash
pnpm db:migration:generate -- src/migrations/AddWorkspace
```

적용:

```bash
pnpm db:migration:run
```

확인:

```bash
pnpm db:migration:show
```

마지막 Migration 되돌리기:

```bash
pnpm db:migration:revert
```

운영 환경에서는 애플리케이션 시작 시 자동 Migration을 실행하지 않습니다. 배포 단계에서 한 번만 실행합니다.

## 7. 품질 검사

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

전체 검사:

```bash
pnpm check
```

CI와 같은 순서로 검사:

```bash
./scripts/check.sh
```

## 8. 새 NestJS 모듈 추가

예를 들어 Site 모듈을 추가합니다.

```bash
pnpm --filter @atlas/api exec nest generate module modules/site
pnpm --filter @atlas/api exec nest generate controller modules/site/presentation/site
pnpm --filter @atlas/api exec nest generate service modules/site/application/site
```

생성 후 `domain`, `application`, `infrastructure`, `presentation` 경계를 정리합니다.

## 9. Worker 확인

Worker는 시작되면 `atlas-system` Queue를 기다립니다. Node REPL 또는 임시 Script에서
`heartbeat` Job을 추가해 기본 연결을 확인할 수 있습니다.

```ts
import { Queue } from 'bullmq';

const queue = new Queue('atlas-system', {
  connection: {
    host: 'localhost',
    port: 6379,
  },
});

await queue.add('heartbeat', {
  source: 'local-test',
});

await queue.close();
```

## 10. 개발 시 주의점

- `.env`는 Commit하지 않습니다.
- MinIO Root Credential을 API나 Worker에 사용하지 않습니다.
- `synchronize: true`를 사용하지 않습니다.
- `main`에 직접 Push하지 않습니다.
- 일반 개발은 `feature/* → develop` Pull Request로 진행합니다.
