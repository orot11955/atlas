# Atlas 브랜치 전략

- 문서 상태: Draft v0.1
- 작성일: 2026-08-29

## 1. 기본 원칙

Atlas는 `develop`과 `main`의 역할을 분리한다.

```text
feature/*
  ↓ Pull Request
develop
  ↓ Release Pull Request
main
  ↓ Tag
Production Deployment
```

- `develop`은 일상적인 개발과 통합의 기준 브랜치다.
- `main`은 운영 배포 가능한 상태만 보존한다.
- 기능 개발, 설계 변경과 일반 문서 수정은 `develop`에 반영한다.
- `main`에 대한 직접 작업은 원칙적으로 금지한다.
- 운영 배포 준비가 완료된 변경만 Pull Request를 통해 `develop`에서 `main`으로 반영한다.

## 2. 브랜치 역할

### `develop`

- 다음 릴리스의 통합 기준
- 기능 브랜치의 기본 대상
- 통합 테스트와 Lab 배포 대상
- 아직 운영에 배포하지 않은 변경 포함 가능

### `main`

- 운영 배포 기준
- 항상 재현 가능한 빌드 상태 유지
- 운영 배포 Commit과 Tag 보존
- 긴급 수정 외 직접 Push 금지

### `feature/*`

새 기능, 리팩터링과 일반 수정에 사용한다.

```text
feature/admin-auth
feature/site-management
feature/minio-media
feature/content-publication
```

생성 기준:

```bash
git switch develop
git pull --ff-only
git switch -c feature/minio-media
```

완료 후 `develop`을 대상으로 Pull Request를 생성한다.

### `fix/*`

운영 긴급 장애가 아닌 일반 버그 수정에 사용한다.

```text
fix/publication-conflict
fix/upload-checksum-validation
```

`develop`에서 분기하고 `develop`으로 병합한다.

### `release/*`

운영 배포 직전 안정화가 필요할 때 선택적으로 사용한다.

```text
release/0.1.0
release/0.2.0
```

```text
develop
  ↓
release/0.1.0
  ├─ 버전 확정
  ├─ Migration 검증
  ├─ Release Note
  ├─ Smoke Test
  └─ 배포 설정 검증
  ↓
main
```

작은 릴리스는 별도 Release Branch 없이 `develop → main` Pull Request로 진행할 수 있다.

### `hotfix/*`

운영 긴급 수정에만 사용한다.

```text
main
  ↓
hotfix/delivery-auth
  ├─ main 병합과 운영 배포
  └─ develop 역병합
```

Hotfix를 `main`에만 반영하면 다음 릴리스에서 수정이 사라질 수 있으므로 반드시 `develop`에도 반영한다.

## 3. Pull Request 흐름

### 기능 개발

```text
feature/*
→ Pull Request to develop
→ Review
→ CI 통과
→ Squash 또는 Rebase Merge
```

### 운영 릴리스

```text
develop 또는 release/*
→ Pull Request to main
→ 전체 검증
→ 운영 승인
→ Merge
→ Version Tag
→ Production Deployment
```

### 긴급 수정

```text
hotfix/* from main
→ Pull Request to main
→ Production Deployment
→ Pull Request 또는 Cherry-pick to develop
```

## 4. CI 기준

### Pull Request to `develop`

```text
Install
→ Lint
→ Typecheck
→ Unit Test
→ Integration Test
→ Build admin-web
→ Build api
→ Build worker
→ TypeORM Migration 검증
→ Docker Compose Config 검증
```

### Push to `develop`

```text
전체 검증
→ Container Image Build
→ Commit SHA Tag
→ Lab 배포
→ Smoke Test
```

초기에는 Lab 자동 배포가 준비되지 않았으면 Build와 Artifact 생성까지만 수행한다.

### Pull Request to `main`

```text
전체 검증
→ Migration 호환성 확인
→ MinIO Bucket과 Policy 변경 확인
→ Production Compose 검증
→ Release Note 확인
→ Rollback 대상 SHA 확인
```

### Push to `main`

```text
Commit SHA Image 확정
→ Version Tag 확인
→ Production 승인
→ Pull
→ Migration
→ Compose Up
→ API Health Check
→ MinIO Health Check
→ Delivery API Smoke Test
→ Deployment Record 저장
```

운영 자동 배포가 준비되기 전에는 `main` Push만으로 실제 배포하지 않고 Manual Workflow 또는 승인 단계를 둔다.

## 5. Tag와 버전

Semantic Versioning을 기본으로 한다.

```text
v0.1.0
v0.2.0
v1.0.0
```

- Tag는 `main`의 Commit에만 생성한다.
- Container Image는 Commit SHA를 기준으로 배포한다.
- Version Tag는 사람이 읽는 Release 식별자로 사용한다.
- 운영 기준으로 `latest` Tag에 의존하지 않는다.

예시:

```text
git.example/orot/atlas-admin:<commit-sha>
git.example/orot/atlas-api:<commit-sha>
git.example/orot/atlas-worker:<commit-sha>
```

## 6. 병합 정책

권장 정책:

- `feature/* → develop`: Squash Merge
- `fix/* → develop`: Squash Merge
- `release/* → main`: Merge Commit 또는 Rebase Merge
- `hotfix/* → main`: Merge Commit
- 이미 원격에 공유한 Branch의 Force Push는 금지

Release 이력을 명확히 남기려면 `develop → main`에는 Merge Commit을 허용한다.

## 7. 보호 규칙 권장안

### `develop`

- Pull Request 필수
- CI 필수
- 대화 미해결 시 병합 금지
- Force Push 금지
- Branch 삭제 금지

### `main`

- Pull Request 필수
- 전체 CI 필수
- 운영 승인 필수
- Force Push 금지
- Branch 삭제 금지
- Tag 생성 권한 제한

초기 단독 개발 단계에서도 최소한 `main` 직접 Push 방지와 CI 필수 규칙은 유지하는 편이 안전하다.

## 8. 현재 적용 상태

```text
develop
└─ main 기준으로 생성

현재 설계와 이후 일반 개발
└─ develop에 반영

main
└─ 향후 운영 배포 기준으로 유지
```

GitHub의 기본 브랜치와 Branch Protection은 저장소 설정에서 별도로 구성한다.
