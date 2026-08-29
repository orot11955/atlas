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

Admin Web API Client 경계:

- Admin API 상대 경로만 허용
- 절대 URL과 직접·인코딩된 Path Traversal 차단
- 경계 오류는 Network Error로 변환하지 않고 요청 전에 거부
- `csrfToken`, `responseType` 같은 Client 전용 옵션은 `fetch`에 전달하지 않음

주요 Pull Request:

- [#2 Shared server package boundary](https://github.com/orot11955/atlas/pull/2)
- [#3 Transaction and audit foundation](https://github.com/orot11955/atlas/pull/3)
- [#4 Structured logging and secret redaction](https://github.com/orot11955/atlas/pull/4)
- [#5 Admin Web API and feedback foundation](https://github.com/orot11955/atlas/pull/5)

## 진행 중

### Phase 2. Admin Identity & Shell

첫 구현 단위:

- `admin_accounts` Migration과 TypeORM Entity
- `OWNER`, `ADMIN`, `EDITOR`, `OPERATOR`, `VIEWER` Role Registry
- 코드 기반 Permission Registry
- Node.js Argon2id Password Hasher와 PHC 문자열 저장
- OWNER Bootstrap CLI
- OWNER Bootstrap Transaction Lock과 중복 실행 차단
- Bootstrap Audit
- CI에서 Migration `up → down → up`과 OWNER Bootstrap 검증

현재 Branch:

```text
feat/admin-identity-schema
```

## 다음

```text
Password Login
→ Login Attempt와 Rate Limit
→ Pending MFA Challenge
→ TOTP 등록과 검증
→ Admin Session과 Cookie
→ CSRF
→ Permission Guard
→ Login UI와 Admin Shell
```
