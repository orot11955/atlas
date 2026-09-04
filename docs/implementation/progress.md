# Atlas 구현 진행 현황

- 기준 브랜치: `develop`
- 갱신일: 2026-09-04

## 완료

### Phase 0. Repository Foundation

- pnpm + Turborepo Monorepo
- Next.js Admin Web, NestJS API, NestJS Worker
- PostgreSQL, Redis, MinIO와 Docker Compose
- Format, Lint, Typecheck, Unit Test, Build, Migration CI

### Phase 1. Server Boundary & Platform Kernel Lite

- `packages/server` Domain/Application/Port/Persistence 경계
- Request Context, UUIDv7, Clock와 Transaction Runner
- Audit Log, Problem Details, Error Registry와 Pino 구조화 Logging
- Secret Redaction과 Admin Web API Client 기반

### Phase 2. Admin Identity & Protected Shell

- OWNER Bootstrap와 Argon2id Password Login
- TOTP MFA, Recovery Code와 Authentication Grant
- Digest 기반 Admin Session과 Double-submit CSRF
- Idle/Absolute Timeout, Session 관리와 Permission Guard
- 보호된 Next.js Admin Shell

### Phase 3. Workspace, Site & API Client

- Workspace와 다중 Site Lifecycle
- Site-scoped Delivery/Integration API Client
- HMAC Digest 기반 API Key 발급·회전·Grace·폐기
- Origin, Scope, Site Access와 Redis Rate Limit

### Phase 4. Project & Deployment Read Model

- Project, Repository, Release, Environment, Service
- Deployment Event와 Health Check의 독립 상태
- Idempotency-Key와 CI Integration Callback
- Admin Project/Deployment 조회 UI

### Phase 5. Resource & Member Directory MVP

- Resource Collection, Markdown/Link/Tag/Project Relation
- Secret Reference와 Credential 원문 저장 차단
- Member, SiteMembership과 Admin Note
- PostgreSQL/MinIO Backup 및 Restore Test Data Gate

### Phase 6. Content Draft & Immutable Revision

- Mutable Content Draft와 독립 `draftVersion`
- Checkpoint/READY immutable Revision
- Server-side Markdown Preview와 Sanitization
- Revision UPDATE/DELETE PostgreSQL Trigger 차단

### Phase 7. Content Publication & Delivery API

- Site별 Content Assignment와 immutable Publication Snapshot
- Publish, Republish, Withdraw와 Rollback
- Delivery 목록/상세, API Key 인증, Cursor, ETag와 304
- Draft 변경과 현재 상태로부터 분리된 공개 Snapshot

### Phase 8. MinIO Media

- Private 원본 Presigned Upload와 서버 Size/SHA/Magic Byte 재검증
- BullMQ + Sharp Media Processing
- Metadata 제거와 immutable WebP/AVIF Public Variant
- READY Asset, AssetUsage와 Publication Asset Manifest
- Content Editor Asset Picker, Cover, Alt Text와 Caption
- ACTIVE Publication 사용 Asset Archive 차단

주요 Pull Request:

- #23 Private Asset Upload Foundation
- #25 Media Processing & Public Variants
- #27 Media Content Publication Snapshot
- #28 Content Editor Asset Picker
- #29 Media Content Lifecycle Completion

### Phase 9. Outbox, Webhook & Scheduling

- Transactional `outbox_events`
- `FOR UPDATE SKIP LOCKED`, Claim Timeout, Stale Recovery와 Dead Retry
- BullMQ `jobId = eventId`
- `event_consumptions` Receipt 기반 Idempotency
- Site별 signed Webhook, AES-256-GCM Secret 저장과 1회 반환
- HMAC-SHA-256 Timestamp/Event ID Signature
- Timeout, Response Size 제한, Retry/Backoff, Dead와 Disable Policy
- Webhook Delivery/Attempt 조회와 수동 재전송
- Site Timezone 기반 Publication Schedule과 UTC 저장
- Due Scanner, 조건부 Claim, Cancel과 Failed Retry
- `/admin/webhooks`와 Content Publication Scheduler UI
- 실제 PostgreSQL·Redis·API·Worker·HTTP Receiver 기반 Eventing Data Gate

상세 구현은 [Phase 9 문서](phase-9-outbox-webhook-scheduling.md)를 따른다.

## 다음

### Phase 10. Content Operations

```text
Taxonomy와 Category/Tag
→ Slug History와 Redirect/410
→ Navigation과 Home Curation
→ RSS, JSON Feed와 Sitemap
→ PostgreSQL Full Text Search
→ OpenGraph와 JSON-LD
→ Revision Diff와 Internal Link Autocomplete
```
