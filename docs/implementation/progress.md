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
- Authentication Grant Transactional 1회 소비
- Digest 기반 Admin Session과 CSRF Token
- Host-only HttpOnly Session Cookie
- Idle·Absolute Timeout과 활동 Touch
- 최대 활성 Session 제한
- Session 목록·Logout·선택 폐기
- Role·Password·Account 상태 변경 시 Session 무효화
- Request Context `ADMIN` Actor와 Permission Guard 기반
- Password → TOTP Setup·Verify → Session 교환 Admin Web 흐름
- Recovery Code 로그인과 최초 Recovery Code 1회 표시
- Next.js Server-side 보호 Layout과 `/login` Redirect
- CSRF Cookie 자동 Header 주입
- Dashboard Foundation과 반응형 Admin Shell
- 활성 Session 관리 화면
- 실제 PostgreSQL·Redis·NestJS 기반 인증 E2E

Admin 인증 API:

```text
POST /api/admin/v1/auth/login
POST /api/admin/v1/auth/mfa/totp/enrollment
POST /api/admin/v1/auth/mfa/totp/confirm
POST /api/admin/v1/auth/mfa/totp/verify
POST /api/admin/v1/auth/mfa/recovery/verify
POST /api/admin/v1/auth/session
GET  /api/admin/v1/auth/session
POST /api/admin/v1/auth/logout
GET  /api/admin/v1/auth/sessions
POST /api/admin/v1/auth/sessions/revoke-others
POST /api/admin/v1/auth/sessions/{sessionId}/revoke
```

Admin Web Route:

```text
/login
/admin
/admin/security/sessions
```

보안 결정:

- Email·IP Fingerprint는 Secret Pepper를 이용한 HMAC-SHA-256이다.
- TOTP Secret은 AES-256-GCM으로 암호화하며 Key Version을 저장한다.
- Recovery Code는 원문을 한 번만 반환하고 HMAC Digest만 저장한다.
- MFA Challenge, Authentication Grant, Session과 CSRF Token은 Digest만 저장한다.
- Login Challenge와 Grant는 Admin Web 메모리 상태에서만 유지하고 영구 저장하지 않는다.
- TOTP Time Step은 계정별로 한 번만 사용할 수 있다.
- Password Login은 Session을 직접 만들지 않으며 MFA 성공 후 Grant를 발급한다.
- 상태 변경 Admin API는 Session과 Double-submit CSRF 검증을 모두 요구한다.
- Role 또는 Password Snapshot이 현재 계정과 다르면 기존 Session을 폐기한다.
- 보호 Route는 Next.js Server Component에서 API Session을 다시 확인한다.

주요 Pull Request:

- [#7 Admin Identity Schema and OWNER Bootstrap](https://github.com/orot11955/atlas/pull/7)
- [#8 Admin Password Login and MFA Challenge](https://github.com/orot11955/atlas/pull/8)
- [#9 Admin Login Privacy Hardening](https://github.com/orot11955/atlas/pull/9)
- [#10 Admin TOTP MFA and Authentication Grants](https://github.com/orot11955/atlas/pull/10)
- [#11 Admin Sessions and CSRF Protection](https://github.com/orot11955/atlas/pull/11)
- [#12 Admin Login Flow and Protected Shell](https://github.com/orot11955/atlas/pull/12)

## 진행 중

### Phase 3. Workspace, Site & API Client

완료된 구현 단위:

- Migration에서 단일 기본 Workspace Bootstrap
- Workspace 이름·Timezone·Locale 설정과 Optimistic Version
- `workspaces`, `sites`, `site_domains`, `site_settings` Schema
- 모든 Site Repository·Service에 `workspaceId` Scope 강제
- Workspace 범위 Site Key·Canonical Domain Unique 제약
- Blog·Portfolio·Docs·Photo·Other Site 유형
- Draft·Active·Maintenance·Disabled·Archived 상태 전이 정책
- Archived Site 수정·재활성화 차단
- Site Cursor Pagination, 검색, 상태·유형 Filter
- Site 생성·조회·수정·상태 변경 API
- Admin Session·Permission·CSRF Guard 연결
- Workspace·Site Audit Log
- Workspace 설정과 Site 목록·등록·상세 관리 UI
- Admin Shell Site 메뉴와 Site Switcher
- 실제 인증 Session 기반 Workspace·Site 통합 E2E

Workspace·Site API:

```text
GET   /api/admin/v1/workspace
PATCH /api/admin/v1/workspace
GET   /api/admin/v1/sites
POST  /api/admin/v1/sites
GET   /api/admin/v1/sites/{siteId}
PATCH /api/admin/v1/sites/{siteId}
POST  /api/admin/v1/sites/{siteId}/activate
POST  /api/admin/v1/sites/{siteId}/maintenance
POST  /api/admin/v1/sites/{siteId}/disable
POST  /api/admin/v1/sites/{siteId}/archive
```

Admin Web Route:

```text
/admin/sites
/admin/sites/new
/admin/sites/{siteId}
```

보안·일관성 결정:

- Workspace ID는 인증된 Admin 요청의 Request Context에 서버에서 주입한다.
- Site Key와 Canonical Domain은 Workspace 범위에서만 Unique하다.
- Site 변경 요청은 현재 Version을 요구하며 충돌 시 `409`를 반환한다.
- Site ID는 UUIDv7만 허용한다.
- Canonical Domain 변경 시 Verification 상태를 `pending`으로 초기화한다.
- 모든 변경 API는 Session, Permission과 Double-submit CSRF를 요구한다.

주요 Pull Request:

- [#13 Workspace and Site Foundation](https://github.com/orot11955/atlas/pull/13)

## 다음

```text
Site Scope API Client Schema
→ API Key 발급과 원문 1회 표시
→ Key Digest 저장
→ Scope·Origin·Rate Limit 정책
→ API Key 회전과 Grace Period
→ 폐기와 최근 사용 시각
→ Admin API Client 관리 화면
```
