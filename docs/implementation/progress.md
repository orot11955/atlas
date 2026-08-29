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

## 진행 중

### Phase 2. Admin Identity & Shell

완료된 구현 단위:

- `admin_accounts` Migration과 TypeORM Entity
- `OWNER`, `ADMIN`, `EDITOR`, `OPERATOR`, `VIEWER` Role Registry
- 코드 기반 Permission Registry
- Node.js Argon2id Password Hasher
- OWNER Bootstrap CLI와 중복 생성 차단
- `admin_login_attempts`와 HMAC-SHA-256 Email·IP Fingerprint
- 짧은 수명의 `admin_login_challenges`
- Password Login Use Case
- 존재하지 않는 Email의 Dummy Hash 검증
- 실패 횟수와 Account Lock
- Account Lock 상태의 외부 응답 평준화
- Redis 기반 IP·Account Rate Limit
- Password 검증 후 MFA Challenge 발급
- Login Audit와 외부 Rate Limit의 `Retry-After`
- `POST /api/admin/v1/auth/login`
- CI의 실제 PostgreSQL·Redis 기반 Password Login API 검증

보안 결정:

- Email·IP Fingerprint는 `AUTH_LOGIN_FINGERPRINT_PEPPER`를 이용한 HMAC-SHA-256이다.
- Pepper는 32바이트 이상이며 운영 Secret Store에서 주입한다.
- 계정 잠금, 비활성 계정, 잘못된 Password는 모두 동일한 `AUTH_REQUIRED` 응답을 사용한다.
- Redis의 IP·Account Rate Limit에 걸린 요청만 429와 `Retry-After`를 반환한다.

주요 Pull Request:

- [#7 Admin Identity Schema and OWNER Bootstrap](https://github.com/orot11955/atlas/pull/7)
- [#8 Admin Password Login and MFA Challenge](https://github.com/orot11955/atlas/pull/8)

## 다음

```text
MFA Method Schema
→ TOTP 등록
→ MFA Challenge 검증과 1회 소비
→ Recovery Code
→ Admin Session과 Cookie
→ CSRF
→ Permission Guard
→ Login UI와 Admin Shell
```
