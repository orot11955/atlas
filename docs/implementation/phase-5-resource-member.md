# Phase 5 — Resource & Member Directory MVP

## 상태

- 구현 상태: 완료
- 반영 브랜치: `develop`
- Pull Request: [#18 Resource & Member Directory MVP](https://github.com/orot11955/atlas/pull/18)
- Merge Commit: `1644396c7e8c9147c95be805ba6b9e9df5b6ae1b`

## Resource Library

구현 모델:

```text
ResourceCollection
Resource
ResourceTag
ResourceTagAssignment
ResourceRelation
ResourceAsset
```

지원 기능:

- Workspace 범위 Collection과 Resource
- Markdown 메모·문서·Checklist·Snippet
- HTTP/HTTPS 외부 Link
- Tag 검색
- Project Relation
- `private`, `workspace` Visibility
- `normal`, `sensitive` Sensitivity
- Optimistic Version
- Archive
- 향후 MinIO Asset 연결을 위한 Relation 골격

Secret 원문은 Resource 본문, 요약과 URL에 저장하지 않는다. Credential로 판단되는 Pattern은 `RESOURCE_SECRET_DETECTED`로 거부하고, 검증된 `secret://...` Reference만 별도 Field에 저장한다.

## Member Directory

구현 모델:

```text
Member
SiteMembership
MemberAdminNote
```

Member는 Workspace에서 한 번 식별하고 Site별 Membership 상태를 독립적으로 관리한다.

```text
pending
active
suspended
withdrawn
```

지원 기능:

- Email 또는 외부 Provider·Subject 기반 수동 등록
- Workspace 범위 Email·외부 Identity 중복 차단
- 전체·Site별 Member 검색
- Site별 Membership 상태 변경
- 관리자 내부 Note
- Optimistic Version
- Archive

회원 Password, Email Verification과 Member Session은 Phase 12에서 구현한다.

Member Note의 작성자 ID는 ambient Context에 의존하지 않고 Controller가 검증된 Admin Session Principal에서 읽어 Application Service에 명시적으로 전달한다. 따라서 Note Row의 `created_by_admin_account_id`는 인증된 관리자 계정과 직접 연결된다.

## Admin API

```text
GET    /api/admin/v1/resource-collections
POST   /api/admin/v1/resource-collections
PATCH  /api/admin/v1/resource-collections/{collectionId}
POST   /api/admin/v1/resource-collections/{collectionId}/archive

GET    /api/admin/v1/resources
POST   /api/admin/v1/resources
GET    /api/admin/v1/resources/{resourceId}
PATCH  /api/admin/v1/resources/{resourceId}
POST   /api/admin/v1/resources/{resourceId}/archive

GET    /api/admin/v1/members
POST   /api/admin/v1/members
GET    /api/admin/v1/members/{memberId}
PATCH  /api/admin/v1/members/{memberId}
POST   /api/admin/v1/members/{memberId}/archive
POST   /api/admin/v1/members/{memberId}/sites/{siteId}/status
POST   /api/admin/v1/members/{memberId}/notes
```

모든 변경 API는 Admin Session, Workspace Scope, Permission, Double-submit CSRF와 Optimistic Version을 요구한다.

## Admin Web

```text
/admin/resources
/admin/resources/{resourceId}
/admin/members
/admin/members/{memberId}
```

자료실과 회원 메뉴를 Admin Navigation의 실제 운영 메뉴로 활성화한다.

## Data Gate B

추가 Script:

```text
scripts/backup/postgres-backup.sh
scripts/backup/postgres-restore-test.sh
scripts/backup/minio-backup.sh
scripts/backup/prune-backups.sh
scripts/backup/run-data-backup.sh
```

Credential 경계:

```text
BACKUP_DATABASE_URL
└─ 운영 Database의 pg_dump 전용 최소 권한

RESTORE_TEST_DATABASE_URL
└─ 운영과 분리된 Restore 검증 Cluster의 임시 Database 생성·삭제 권한

BACKUP_MINIO_ACCESS_KEY / BACKUP_MINIO_SECRET_KEY
└─ 지정 Bucket의 List/Get 전용
```

운영 Database Credential과 Restore Test Credential을 공유하지 않는다.

## 검증

```text
Prettier
ESLint
Typecheck
Unit Test
NestJS·Next.js Production Build
Migration up → down → up
PostgreSQL Custom Dump
격리 Database Restore Test
Resource·Member 실제 API E2E
기존 Admin·Site·Project 기능 회귀 검사
```

Resource·Member E2E는 Credential 저장 차단, Tag·Project Filter, Resource Archive, Email 중복 차단, Site별 Membership 분리, Admin Note 작성자 보존과 Member Archive를 검증한다.

## 다음 Phase

```text
Phase 6 — Content Draft & Revision
```

구현 순서:

```text
Content
→ ContentDraft
→ Markdown Autosave
→ Optimistic Lock
→ Immutable ContentRevision
→ Server Preview와 Sanitization
→ Revision 목록·복구
→ READY Validation
```
