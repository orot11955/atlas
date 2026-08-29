# Atlas 구현 진행 현황

- 기준 브랜치: `develop`
- 갱신일: 2026-08-29

## 완료

### Phase 0. Repository Foundation

- Monorepo, CI, Docker Compose
- PostgreSQL, Redis, MinIO
- Next.js Admin Web, NestJS API, NestJS Worker

### Phase 1. Server Boundary & Platform Kernel Lite

- `packages/server` 공유 경계
- Request Context와 Worker Job Context
- Problem Details와 Error Code Registry
- UUIDv7와 Clock
- Transaction Runner와 TypeORM Adapter
- 최소 Audit Schema, Service와 Metadata Redaction
- Pino 구조화 Logging과 Secret Redaction
- HTTP 요청 완료 Log와 Worker Queue·Job Log
- Admin Web API Client와 Problem Details Parser
- Form Error Mapper
- Loading, Empty/Not Found, Error 상태 기반
- PostgreSQL Migration `up → down → up` CI

주요 Pull Request:

- [#2 Shared server package boundary](https://github.com/orot11955/atlas/pull/2)
- [#3 Transaction and audit foundation](https://github.com/orot11955/atlas/pull/3)
- [#4 Structured logging and secret redaction](https://github.com/orot11955/atlas/pull/4)
- [#5 Admin Web API and feedback foundation](https://github.com/orot11955/atlas/pull/5)

## 다음

### Phase 2. Admin Identity & Shell

첫 구현 흐름:

```text
AdminAccount, Role, Permission Migration
→ OWNER Bootstrap CLI
→ Password Login
→ Pending MFA Challenge
→ TOTP 등록과 검증
→ Admin Session
→ CSRF
→ Permission Guard
→ Login UI와 Admin Shell
```

Phase 2 첫 권장 Branch:

```text
feat/admin-identity-schema
```
