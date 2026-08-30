# Phase 7 — Content Publication & Delivery

## 구현 경계

원본 Content와 공개 응답을 분리한다.

```text
Content
├─ ContentDraft                  Mutable
├─ ContentRevision              Immutable
└─ ContentSite[]
   └─ ContentPublication[]      Immutable Snapshot
```

`ContentSite`는 Site별 배치 설정을 보유한다. `ContentPublication`은 공개 시점의 READY Revision, Site와 Override를 복사한 단일 공개 Source of Truth다.

## ContentSite

```text
workspaceId
contentId
siteId
slug
titleOverride
summaryOverride
seo
visibility
version
```

규칙:

- 동일 Workspace의 Content와 Site만 연결한다.
- 동일 Content를 동일 Site에 중복 배치하지 않는다.
- Site 안에서 Slug는 Unique하다.
- Archived Content와 Archived Site에는 새 배치를 만들 수 없다.
- 변경은 `version` 기반 Optimistic Lock을 사용한다.
- 설정 변경은 기존 ACTIVE Publication을 수정하지 않는다. 다시 Publish해야 공개 응답이 변경된다.

Visibility:

```text
public
└─ 목록과 상세에 노출

unlisted
└─ 목록에서는 제외하고 정확한 Slug 상세에는 노출

private
└─ Delivery API에서 제외
```

## Publish

Publish는 현재 Draft나 Checkpoint를 사용하지 않는다.

```text
Content.readyRevisionNumber
→ 같은 번호의 READY ContentRevision
→ ContentSite 설정과 결합
→ ContentPublication INSERT
```

한 Transaction에서 다음 순서로 실행한다.

```text
ContentSite Row Lock
→ Content와 READY Revision 확인
→ Site ACTIVE 확인
→ 공개 Snapshot과 ETag 생성
→ 동일 Snapshot 재요청이면 현재 ACTIVE Publication 반환
→ Site Slug 충돌 확인
→ 기존 ACTIVE Publication을 SUPERSEDED로 전환
→ 새 ACTIVE Publication INSERT
→ Audit 기록
```

DB Partial Unique Index가 다음 조건을 최종 보장한다.

```text
Workspace + ContentSite당 ACTIVE 최대 1개
Workspace + Site + Slug당 ACTIVE 최대 1개
```

## 불변 Publication Snapshot

Snapshot에 다음 공개 데이터를 복사한다.

```text
Content Type
Site ID, Key, Name
Revision ID와 Number
Slug
Title
Summary
Sanitized Body HTML
SEO JSON
Visibility
ETag
Published At
```

`content_publications` Trigger는 Payload UPDATE와 DELETE를 차단한다. 허용되는 UPDATE는 ACTIVE에서 `SUPERSEDED` 또는 `WITHDRAWN`으로의 수명주기 전환뿐이다.

Site 이름이나 Content Draft가 변경돼도 기존 공개 응답과 ETag는 유지된다. 새 Snapshot을 Publish한 뒤에만 공개 응답이 바뀐다.

## Withdraw와 Rollback

Withdraw:

```text
ACTIVE
→ WITHDRAWN
→ Delivery API에서 제외
```

Rollback은 과거 Row를 다시 활성화하지 않는다.

```text
과거 Publication Snapshot 선택
→ 현재 ACTIVE를 SUPERSEDED
→ 과거 Payload를 복사한 새 ACTIVE Publication INSERT
```

따라서 공개 이력이 Append-only로 유지된다.

## Admin API

```text
GET   /api/admin/v1/contents/{contentId}/sites
POST  /api/admin/v1/contents/{contentId}/sites
PATCH /api/admin/v1/contents/{contentId}/sites/{contentSiteId}

POST  /api/admin/v1/contents/{contentId}/sites/{contentSiteId}/publish
POST  /api/admin/v1/contents/{contentId}/sites/{contentSiteId}/withdraw

GET   /api/admin/v1/contents/{contentId}/sites/{contentSiteId}/publications
POST  /api/admin/v1/contents/{contentId}/sites/{contentSiteId}/publications/{publicationId}/rollback
```

조회는 `contents:read`, 변경은 `contents:manage`, Admin Session과 Double-submit CSRF를 요구한다.

## Delivery API

```text
GET /api/delivery/v1/sites/{siteKey}/contents
GET /api/delivery/v1/sites/{siteKey}/contents/{slug}
GET /api/delivery/v1/sites/{siteKey}/posts
GET /api/delivery/v1/sites/{siteKey}/posts/{slug}
```

인증 조건:

```text
Delivery API Client
+ content:read Scope
+ 요청 Site Access
+ Client·Key·Site ACTIVE 조건
+ Origin 정책
+ Redis Rate Limit
```

목록은 `publishedAt DESC, publicationId DESC` Cursor Pagination을 사용한다. 상세 응답은 다음 Cache 계약을 제공한다.

```http
ETag: "<sha256>"
Cache-Control: public, max-age=60, stale-while-revalidate=300
Vary: Authorization, Origin
```

`If-None-Match`가 현재 ETag와 일치하면 `304 Not Modified`를 반환한다.

공개 DTO는 `schemaVersion: 1`을 포함하고 내부 Entity, Bucket, Object Key, Database 정보와 Draft Markdown을 노출하지 않는다.

## Admin Web

기존 Content Editor에 Publication Manager를 연결한다.

```text
/admin/contents/{contentId}
```

지원 범위:

- Site 배치
- Slug와 Visibility
- 제목·요약 Override
- SEO JSON
- 현재 ACTIVE Revision 확인
- READY Publish
- Withdraw
- Publication History
- 과거 Snapshot Rollback

## 검증 Gate

- Prettier, ESLint, Typecheck
- 전체 Unit Test와 Production Build
- Migration `up → down → up`
- Password → TOTP → Session과 CSRF 기반 Admin E2E
- READY 전 Draft 비노출
- Publish 자연 Idempotency
- Site Scope 불일치 `403`
- ETag와 `304`
- 재발행 후 이전 Snapshot `SUPERSEDED`
- Withdraw 후 상세 `404`
- Rollback이 새 Publication Row를 생성
- Payload UPDATE와 DELETE를 PostgreSQL Trigger가 차단
- ContentSite당 ACTIVE와 Site Slug당 ACTIVE 단일성

## 후속 범위

실패 시도 이력과 비동기 재처리는 Publication Snapshot에 `FAILED` Row를 만들지 않고 별도의 Attempt·Outbox 경계에서 구현한다. Phase 8 Media가 Publication Asset Manifest를 추가하고, Phase 9가 Outbox와 Scheduling을 연결한다.
