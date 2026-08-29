# Atlas 인프라

로컬 개발 환경은 루트의 `compose.yml`로 관리합니다.

## 서비스

| 서비스        | 용도                     | 기본 포트 |
| ------------- | ------------------------ | --------: |
| PostgreSQL    | 영속 데이터와 Migration  |      5432 |
| Redis         | BullMQ, Lock, 짧은 Cache |      6379 |
| MinIO API     | Object Storage           |      9000 |
| MinIO Console | 로컬 관리 UI             |      9001 |
| Nginx         | 전체 Stack 진입점        |      8080 |

## MinIO Bucket

```text
atlas-private
└─ 업로드 원본

atlas-processing
└─ Worker의 변환 중간 결과

atlas-public
└─ 외부 Site가 사용하는 공개 Variant
```

`infra/minio/init.sh`는 다음 항목을 멱등하게 초기화합니다.

- 세 Bucket 생성
- API 전용 사용자와 Policy 생성
- Worker 전용 사용자와 Policy 생성
- `atlas-public`에 Download-only 공개 정책 적용

로컬 개발용 Root Credential은 `.env`에만 두며 애플리케이션 Container에는 전달하지 않습니다.

## 실행

인프라만 실행:

```bash
pnpm infra:up
```

애플리케이션까지 Docker로 실행:

```bash
pnpm stack:up
```

전체 로그:

```bash
pnpm stack:logs
```

Volume을 포함한 초기화:

```bash
pnpm infra:reset
```

## 운영 배포 전 변경 사항

현재 Compose는 로컬 개발 기준입니다. 운영에서는 다음 항목을 별도 구성해야 합니다.

- `latest` Image Tag를 고정된 Release Tag 또는 Digest로 교체
- PostgreSQL, Redis와 MinIO Port 외부 노출 제거
- MinIO Console의 인터넷 접근 차단
- TLS 적용
- Secret Store 또는 서버 환경 파일 사용
- PostgreSQL과 MinIO Backup
- MinIO Bucket Versioning 및 Lifecycle Policy
- Nginx Rate Limit과 보안 Header
- Container Resource Limit
- Health Check와 Monitoring
