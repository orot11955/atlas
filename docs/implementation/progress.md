# Atlas 구현 진행 현황

- 기준 브랜치: `develop`
- 갱신일: 2026-08-30

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
- 코드 기반 Role·Permission Registry
- Node.js Argon2id Password Hasher
- OWNER Bootstrap CLI와 중복 생성 차단
- HMAC-SHA-256 Email·IP Login Fingerprint
- Password Login과 Dummy Hash 검증
- Account Lock과 외부 응답 평준화
- Redis 기반 IP·Account Rate Limit
- Password 검증 후 MFA Challenge 발급
- TOTP Secret AES-256-GCM 암호화 저장
- TOTP 등록과 활성화
- RFC 6238 TOTP 검증과 Time Step Replay 차단
- Recovery Code HMAC Digest와 1회 소비
- MFA Challenge Client Address Binding
- MFA 실패 횟수와 Challenge 무효화
- Session 생성 전 일회성 Authentication Grant
- 실제 PostgreSQL·Redis·NestJS 기반 인증 E2E

Admin 인증 API:

```text
POST /api/admin/v1/auth/login
POST /api/admin/v1/auth/mfa/totp/enrollment
POST /api/admin/v1/auth/mfa/totp/confirm
POST /api/admin/v1/auth/mfa/totp/verify
POST /api/admin/v1/auth/mfa/recovery/verify
```

보안 결정:

- Email·IP Fingerprint는 Secret Pepper를 이용한 HMAC-SHA-256이다.
- TOTP Secret은 AES-256-GCM으로 암호화하며 Key Version을 저장한다.
- Recovery Code는 원문을 한 번만 반환하고 HMAC Digest만 저장한다.
- MFA Challenge와 Authentication Grant Token은 SHA-256 Digest만 저장한다.
- TOTP Time Step은 계정별로 한 번만 사용할 수 있다.
- Password Login은 Session을 직접 만들지 않으며 MFA 성공 후 Grant를 발급한다.

주요 Pull Request:

- [#7 Admin Identity Schema and OWNER Bootstrap](https://github.com/orot11955/atlas/pull/7)
- [#8 Admin Password Login and MFA Challenge](https://github.com/orot11955/atlas/pull/8)
- [#9 Admin Login Privacy Hardening](https://github.com/orot11955/atlas/pull/9)

## 다음

```text
Authentication Grant 검증과 1회 소비
→ Admin Session과 HttpOnly Cookie
→ Idle·Absolute Timeout
→ CSRF
→ Permission Guard
→ Login UI와 Admin Shell
```
