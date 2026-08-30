# Atlas Data Backup and Retention

## 목적

실제 개인 자료와 Member 데이터를 저장하기 전에 PostgreSQL과 MinIO의 독립 Backup 경로와 Restore 검증 절차를 고정한다.

## Credential 분리

```text
BACKUP_DATABASE_URL
└─ 운영 Database 읽기와 pg_dump에 필요한 최소 권한

RESTORE_TEST_DATABASE_URL
└─ 운영과 분리된 Restore 검증 Cluster
└─ 임시 Database 생성·삭제 권한

BACKUP_MINIO_ACCESS_KEY / BACKUP_MINIO_SECRET_KEY
└─ atlas-private, atlas-processing, atlas-public의 List/Get 전용
```

운영 Database 사용자에게 `CREATEDB`를 부여하지 않는다. Restore Test는 별도 PostgreSQL Instance 또는 별도 Test Cluster에서 실행한다.

## PostgreSQL

```bash
archive="$(
  BACKUP_DATABASE_URL='postgresql://atlas_backup:...@db:5432/atlas' \
  BACKUP_ROOT='/var/backups/atlas' \
  pnpm --silent backup:postgres
)"

RESTORE_TEST_DATABASE_URL='postgresql://atlas_restore:...@restore-db:5432/postgres' \
  pnpm --silent backup:restore-test -- "$archive"
```

Backup은 Custom Format, `--no-owner`, `--no-acl`로 생성하고 SHA-256 파일을 함께 저장한다. Restore Test는 임시 Database를 생성하고 Migration Table, `resources`, `members` Table 존재를 검증한 뒤 제거한다.

## MinIO

```bash
BACKUP_MINIO_ENDPOINT='https://minio.internal.example' \
BACKUP_MINIO_ACCESS_KEY='atlas-backup' \
BACKUP_MINIO_SECRET_KEY='...' \
BACKUP_ROOT='/var/backups/atlas' \
pnpm --silent backup:minio
```

Bucket별 Mirror를 만든 뒤 전체 파일의 SHA-256 Manifest를 기록한다. Backup Credential에는 Put/Delete 권한을 부여하지 않는다.

## 보존

기본 보존 기간은 35일이다.

```bash
BACKUP_ROOT='/var/backups/atlas' \
BACKUP_RETENTION_DAYS=35 \
pnpm --silent backup:prune
```

최소 권장 보존:

```text
Daily   35일
Monthly 12개월 — NAS Snapshot 또는 별도 Archive Tier
```

## systemd

```bash
sudo install -m 0644 infra/backup/atlas-data-backup.service /etc/systemd/system/
sudo install -m 0644 infra/backup/atlas-data-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now atlas-data-backup.timer
```

`/etc/atlas/backup.env`는 `0600`, 소유자는 `atlas-backup`으로 유지한다.

## 복구 원칙

1. 운영 Instance에 직접 Restore Test를 수행하지 않는다.
2. 가장 최근 Dump의 SHA-256을 확인한다.
3. 격리된 PostgreSQL에서 Restore와 최소 Query를 검증한다.
4. MinIO Manifest를 검증한다.
5. 실제 복구 전 Atlas API와 Worker를 중지한다.
6. 복구 완료 후 Migration 상태, Admin Login, Resource·Member 조회를 확인한다.
