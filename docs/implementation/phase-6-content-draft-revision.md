# Phase 6 — Content Draft & Revision

## 구현 경계

Atlas의 원본 Content는 Workspace에 속하며 Site별 발행 설정과 분리한다.

```text
Workspace
└─ Content
   ├─ ContentDraft
   └─ ContentRevision[]
```

Site별 Slug, 제목 Override와 공개 상태는 다음 Publication Phase에서 `ContentSite`로 연결한다.

## Version 모델

```text
Content.version
└─ 상태와 Revision Pointer 변경

ContentDraft.draftVersion
└─ Autosave와 Revision 복구
```

Draft 저장만으로 Revision을 생성하지 않는다. Checkpoint 또는 READY 작업에서만 불변 Revision과 Content Version을 갱신한다.

## Revision Pointer

```text
currentRevisionNumber
└─ 가장 최근 Checkpoint 또는 READY Revision

readyRevisionNumber
└─ 가장 최근 READY Validation을 통과한 Revision
```

READY 이후 Checkpoint가 추가돼도 `readyRevisionNumber`는 변경하지 않는다. Publication은 READY Pointer가 가리키는 Revision만 사용할 수 있다.

## 불변성

`content_revisions`는 INSERT와 SELECT만 허용한다. PostgreSQL Trigger가 UPDATE와 DELETE를 차단한다. 과거 Revision 복구는 Snapshot을 Mutable Draft로 복사하고 `draftVersion`을 증가시킨다.

## Admin API

```text
GET    /api/admin/v1/contents
POST   /api/admin/v1/contents
GET    /api/admin/v1/contents/{contentId}
PATCH  /api/admin/v1/contents/{contentId}/draft
POST   /api/admin/v1/contents/{contentId}/preview
POST   /api/admin/v1/contents/{contentId}/checkpoints
POST   /api/admin/v1/contents/{contentId}/ready
GET    /api/admin/v1/contents/{contentId}/revisions
POST   /api/admin/v1/contents/{contentId}/revisions/{revisionId}/restore
POST   /api/admin/v1/contents/{contentId}/archive
```

## Admin Web

```text
/admin/contents
/admin/contents/{contentId}
```

Editor는 1.2초 Debounce Autosave, 충돌 표시, Server Preview, Checkpoint, READY Validation, Revision 복구와 Archive를 제공한다.

## 보안 경계

- 조회는 `content.read` Permission을 요구한다.
- 변경은 `content.manage`, Admin Session과 Double-submit CSRF를 요구한다.
- Markdown Raw HTML은 Escape한다.
- `javascript:`와 `data:` Link는 제거한다.
- READY Revision에는 Sanitized HTML Snapshot을 저장한다.
- Audit에는 본문 전체를 복제하지 않고 Revision 식별자와 Version만 기록한다.

## 검증 Gate

일반 Pull Request CI에서 Repository에 고정된 TypeScript와 Prettier 버전을 사용해 Format, Lint, Typecheck, Unit Test, Production Build와 Migration `up → down → up`을 검증한다. 모든 검사를 통과한 소스만 `develop`에 병합하며, 일회성 Workflow나 진단 파일은 구현 결과물에 포함하지 않는다.
