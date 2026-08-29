# Atlas Acceptance와 Release Gate

- 문서 상태: Draft v0.1
- 상위 문서: [전체 구현 로드맵](../implementation-roadmap.md)
- 목적: 기능 완료를 체크박스 개수로 판단하지 않고 사용자 흐름, 보안 경계, 데이터 무결성과 복구 가능성으로 검증한다.

---

## 1. 공통 품질 기준

모든 PR은 다음 명령 중 변경 범위에 해당하는 검사를 통과한다.

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Schema 또는 Infra 변경 시 추가한다.

```bash
pnpm db:migration:show
docker compose config
```

## 1.1 위험 기반 Definition of Done

### Schema 변경

- [ ] Up Migration
- [ ] 기존 데이터 호환성
- [ ] Unique·Foreign Key·Check Constraint
- [ ] 필요한 Index
- [ ] Rollback 또는 Forward Fix 전략

### Domain 변경

- [ ] 정상 상태 전이 Test
- [ ] 허용되지 않은 상태 전이 Test
- [ ] Workspace·Site Scope Test
- [ ] 동시성 또는 중복 요청 Test

### API 변경

- [ ] OpenAPI 반영
- [ ] 성공·오류 Contract
- [ ] 401·403 구분
- [ ] Validation Error
- [ ] 내부 Entity와 Secret 미노출
- [ ] Pagination과 Cache Header 검증

### Admin UI 변경

- [ ] Loading
- [ ] Empty
- [ ] Error
- [ ] 권한 없는 Action 미노출
- [ ] Server Validation 표시
- [ ] Version Conflict 처리
- [ ] Keyboard와 기본 접근성

### Worker·Integration 변경

- [ ] Retry
- [ ] Timeout
- [ ] 중복 처리
- [ ] Crash Recovery
- [ ] 실패 상태 조회
- [ ] 수동 복구 방법

### 보안·개인정보 변경

- [ ] Audit 대상 확정
- [ ] Log Redaction
- [ ] Rate Limit
- [ ] Token 만료와 폐기
- [ ] 개인정보 보존과 삭제
- [ ] 외부 노출 경계 Test

---

## 2. 단계별 Gate

## Gate A. Admin Exposure

관리자 패널을 인터넷 또는 외부 네트워크에 노출하기 전 통과한다.

- [ ] TLS
- [ ] Host-only Secure Cookie
- [ ] `HttpOnly`
- [ ] `SameSite=Strict`
- [ ] CSRF Synchronizer Token
- [ ] Login Rate Limit
- [ ] Account Lock 또는 지연 정책
- [ ] TOTP MFA
- [ ] Session Idle Timeout
- [ ] Session Absolute Timeout
- [ ] 기본 CSP
- [ ] Security Header
- [ ] Admin Domain과 Site Domain Cookie 분리
- [ ] 로그인·MFA·Session Audit

실패 조건:

```text
HTTP에서 운영 Session Cookie 발급
Client JavaScript가 Session Token 접근
CSRF 없이 상태 변경 가능
MFA 우회 가능
외부 Site Domain으로 Admin Cookie 전송
```

---

## Gate B. Real Data Storage

개인 자료 또는 실제 회원 정보를 입력하기 전 통과한다.

- [ ] PostgreSQL 자동 Backup
- [ ] Backup 성공 여부 확인
- [ ] PostgreSQL Restore Test 1회 이상
- [ ] MinIO Backup 대상과 주기
- [ ] Backup Credential 분리
- [ ] Backup 암호화 정책
- [ ] Retention
- [ ] Soft Delete 대상
- [ ] Hard Delete 시점
- [ ] 복구 Runbook
- [ ] Public 저장소에 실제 개인정보·Credential 없음

실패 조건:

```text
Backup 파일은 있으나 Restore 검증 없음
MinIO 원본만 단일 저장
탈퇴·삭제 후 복구와 보존 기준 없음
운영 Secret을 Repository에 Commit
```

---

## Gate C. Public Delivery

Delivery API와 공개 Asset Endpoint를 실제 Site에서 사용하기 전 통과한다.

- [ ] Site A Key로 Site B 접근 불가
- [ ] Scope 부족 403
- [ ] 만료·폐기 Key 거부
- [ ] Key Rotation
- [ ] API Rate Limit
- [ ] Publication ACTIVE만 반환
- [ ] PRIVATE와 MEMBERS_ONLY 노출 차단
- [ ] Internal ID 노출 정책 검토
- [ ] MinIO Bucket·Object Key 미노출
- [ ] ETag
- [ ] `304 Not Modified`
- [ ] Cache-Control
- [ ] Nginx GET·HEAD 제한
- [ ] Public Bucket List 금지
- [ ] Withdraw와 Redirect 정책

실패 조건:

```text
Draft 또는 최신 Revision이 직접 노출
다른 Site Publication 조회 가능
API Key가 Browser Bundle에 포함
MinIO 내부 Endpoint 반환
Public Asset Bucket 목록 조회 가능
```

---

## Gate D. Member Privacy

회원가입과 로그인을 외부 Site에서 활성화하기 전 통과한다.

- [ ] 수집 필드 최소화
- [ ] Email Verification
- [ ] Password Argon2id
- [ ] Password Reset Token 만료·1회 사용
- [ ] Admin Session과 Member Session 분리
- [ ] Site별 Membership 상태
- [ ] Consent 문서 Version
- [ ] 회원 데이터 Export
- [ ] 탈퇴
- [ ] 보존 기간
- [ ] 익명화
- [ ] 회원 정보 조회 Audit
- [ ] Login Rate Limit
- [ ] 동일 이메일 연결 정책

실패 조건:

```text
검증되지 않은 동일 이메일 자동 병합
Site A 정지가 무조건 Site B를 정지
탈퇴 후 개인정보가 무기한 유지
관리자가 회원 민감정보를 조회해도 Audit 없음
```

---

## Gate E. Deployment Control

재배포, Workflow Trigger와 Rollback을 활성화하기 전 통과한다.

- [ ] 위험 작업 Reauthentication
- [ ] Project Allowlist
- [ ] Environment Allowlist
- [ ] Command Registry
- [ ] Parameter Schema
- [ ] Reason 필수
- [ ] Dry-run
- [ ] Deployment Lock
- [ ] Production Lock
- [ ] 중복 요청 Idempotency
- [ ] Timeout
- [ ] 실행 요청과 결과 Audit
- [ ] 이전 성공 Release 선택
- [ ] DB Migration 상태 표시
- [ ] 자동 Down Migration 금지
- [ ] Rollback 후 Health Check
- [ ] Incident 연결

실패 조건:

```text
Browser가 Docker Socket에 접근
임의 Shell Command 입력
Client가 전달한 임의 URL Health Check
재인증 없이 Production Rollback
대상 SHA를 표시하지 않고 실행
```

---

## Gate F. Production Release

`develop`을 `main`에 병합하고 운영 배포하기 전 통과한다.

- [ ] `main` Direct Push 금지
- [ ] Required CI
- [ ] Release PR
- [ ] Image Commit SHA Tag
- [ ] Migration Precheck
- [ ] Backup Precheck
- [ ] SBOM
- [ ] Vulnerability Scan
- [ ] Secret Scan
- [ ] Container Non-root
- [ ] LAB Smoke Test
- [ ] Production 승인
- [ ] Health Check
- [ ] Deployment Record
- [ ] 이전 Image Rollback Test
- [ ] PostgreSQL Restore Drill
- [ ] MinIO Object Restore Drill
- [ ] Alert Rule
- [ ] DR Runbook

---

## 3. 핵심 Acceptance Scenario

## 3.1 관리자 로그인

```gherkin
Given OWNER 계정이 Bootstrap되어 있다
And TOTP가 등록되어 있다
When 올바른 Password로 로그인한다
Then MFA Challenge가 생성된다
When 올바른 TOTP를 제출한다
Then Server-side Admin Session이 생성된다
And Host-only HttpOnly Cookie가 발급된다
And 로그인 Audit가 저장된다
When 미인증 사용자가 Admin API를 호출한다
Then 401 AUTH_REQUIRED를 반환한다
```

## 3.2 Site와 API Client 격리

```gherkin
Given main-blog와 dev-log Site가 있다
And main-blog 전용 Delivery Client가 있다
When Client가 main-blog Endpoint를 호출한다
Then 요청을 허용한다
When 같은 Client가 dev-log Endpoint를 호출한다
Then 403 SITE_NOT_ACCESSIBLE을 반환한다
And Secret 원문은 DB와 Log에 존재하지 않는다
```

## 3.3 Deployment Callback 멱등성

```gherkin
Given CI Client가 deployment:create Scope를 가진다
When 동일 Idempotency-Key와 동일 Payload로 두 번 요청한다
Then Deployment는 하나만 생성된다
And 두 번째 요청은 최초 결과를 반환한다
When 동일 Key와 다른 Payload를 요청한다
Then 409 IDEMPOTENCY_CONFLICT를 반환한다
```

## 3.4 배포 성공과 Health 실패

```gherkin
Given Deployment가 RUNNING 상태다
When CI가 SUCCEEDED 결과를 보낸다
And 등록된 Health Check가 DOWN을 반환한다
Then Deployment는 SUCCEEDED로 기록된다
And Service Health는 DOWN으로 기록된다
And 관리자 화면은 두 상태를 별도로 표시한다
```

## 3.5 Resource와 Member Directory

```gherkin
Given main-blog와 dev-log Site가 있다
When 관리자가 Resource를 Project에 연결한다
Then Project 상세에서 Resource를 조회할 수 있다
When 동일 Member를 두 Site에 가입시킨다
And main-blog Membership만 SUSPENDED로 변경한다
Then dev-log Membership은 기존 상태를 유지한다
```

## 3.6 Draft Autosave와 Revision

```gherkin
Given POST Content와 빈 ContentDraft가 있다
When 사용자가 본문을 여러 번 Autosave한다
Then 하나의 ContentDraft가 Version과 함께 갱신된다
And Autosave 횟수만큼 Revision이 생성되지 않는다
When 사용자가 Checkpoint를 생성한다
Then Immutable ContentRevision 하나가 생성된다
```

## 3.7 Revision 복구

```gherkin
Given Revision 1과 Revision 2가 있다
When Revision 1을 복구한다
Then Revision 1 자체는 수정되지 않는다
And Revision 1 내용이 ContentDraft에 복사된다
When 새 Checkpoint를 생성한다
Then Revision 3이 생성된다
```

## 3.8 Site별 Publication

```gherkin
Given READY Revision과 main-blog, dev-log가 있다
When main-blog에는 atlas-design으로 게시한다
And dev-log에는 atlas-design-internals로 게시한다
Then 각 ContentSite에 별도의 ACTIVE Publication이 생성된다
And Site별 route와 SEO를 반환한다
```

## 3.9 공개 글 수정

```gherkin
Given main-blog에 ACTIVE Publication A가 있다
When ContentDraft를 수정하고 Revision B를 만든다
Then Delivery API는 계속 Publication A를 반환한다
When Revision B를 다시 게시한다
Then Publication B가 ACTIVE가 된다
And Publication A는 SUPERSEDED가 된다
And ETag가 변경된다
```

## 3.10 Publication 동시 실행

```gherkin
Given 같은 ContentSite와 Revision에 대한 Publish 요청 두 개가 동시에 실행된다
When 두 Transaction이 ACTIVE Publication을 생성하려 한다
Then ACTIVE Partial Unique Constraint로 하나만 성공한다
And 실패 요청은 기존 성공 결과 또는 명확한 Conflict를 반환한다
```

## 3.11 MinIO Upload

```gherkin
Given 유효한 Upload Session이 있다
When Browser가 Presigned URL로 atlas-private에 Upload한다
And Complete API를 호출한다
Then API는 statObject, 크기와 Checksum을 검증한다
And Worker는 공개 Variant를 생성한다
And Delivery 응답에는 Private Bucket과 Object Key가 포함되지 않는다
```

## 3.12 중복 Outbox Delivery

```gherkin
Given 하나의 Outbox Event가 BullMQ에 두 번 등록된다
When 동일 Consumer가 두 Job을 처리한다
Then EventConsumption Unique Constraint로 부작용은 한 번만 반영된다
And 두 Job은 처리 결과를 명확히 기록한다
```

## 3.13 예약 게시

```gherkin
Given 미래 시각의 PublicationSchedule이 있다
When Due Scanner가 같은 Schedule을 중복 Claim한다
Then 조건부 상태 전이로 하나의 Worker만 PROCESSING을 획득한다
And Publication ACTIVE 결과는 한 번만 반영된다
```

## 3.14 Webhook 재시도

```gherkin
Given Site Webhook Endpoint가 일시적으로 500을 반환한다
When content.published Event를 전달한다
Then WebhookDelivery는 FAILED로 기록된다
And Backoff Schedule에 따라 재시도한다
When 수신 측이 동일 Event ID를 다시 받는다
Then 중복 처리가 가능하도록 Event ID와 Timestamp 서명이 포함된다
```

## 3.15 Deployment Rollback

```gherkin
Given Production의 현재 Release와 이전 성공 Release가 있다
When OWNER가 재인증하고 이전 SHA를 확인한 뒤 Rollback한다
Then Allowlisted Workflow만 실행된다
And DB Down Migration은 실행되지 않는다
And Rollback 후 Health Check와 Audit가 기록된다
```

## 3.16 회원 탈퇴와 익명화

```gherkin
Given Member가 여러 Site Membership을 가진다
When 회원이 탈퇴를 요청한다
Then 신규 Session 발급을 중지한다
And 보존 기간 후 익명화 Job이 실행된다
And 법적 보존 필드와 식별 가능 개인정보를 분리한다
```

---

## 4. Milestone Release 조건

## Milestone A: Secure Admin

- [ ] Phase 0~3 완료
- [ ] Gate A 통과
- [ ] Site 두 개 생성
- [ ] Site별 API Key 격리
- [ ] 관리자 Session 관리

## Milestone B: Personal Operations MVP

- [ ] Phase 4~5 완료
- [ ] Gate B 통과
- [ ] Project와 Deployment 조회
- [ ] 개인 Resource 저장
- [ ] Member Directory

## Milestone C: Headless CMS MVP

- [ ] Phase 6~7 완료
- [ ] Gate C 통과
- [ ] Draft Autosave
- [ ] Revision
- [ ] Site별 Publication
- [ ] Delivery API E2E

## Milestone D: Operable CMS

- [ ] Phase 8~10 완료
- [ ] MinIO Upload와 Variant
- [ ] Webhook 재시도
- [ ] 예약 게시
- [ ] Feed, Sitemap과 Search

## Milestone E: Control and Membership

- [ ] Phase 11~13 완료
- [ ] Gate D와 E 통과
- [ ] 제한된 Deployment Control
- [ ] Member Authentication
- [ ] Dashboard와 Notification

## Production

- [ ] Phase 14 완료
- [ ] Gate F 통과
- [ ] `main` Tag 배포
- [ ] Rollback과 Restore Drill 기록
