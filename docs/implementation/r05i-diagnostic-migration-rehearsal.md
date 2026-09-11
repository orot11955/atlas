# R05-I — 진단 정리 Migration 잠금·원복 인수

## 범위

R05-H 이후의 다음 운영 인수 항목이다. 기존 R05-E/F의 HTTP·Scheduler 검사,
R05-G Preflight, R05-H 논리 복구를 다시 구현하지 않는다.
기존 Preflight Gate의 pre-policy 시점에 실제 진단 정리 Migration 검사를 연결한다.
별도 Workflow, 제품 코드, 새로운 Migration, 의존성 또는 Compose 변경은 없다.

**PR #31은 Draft·미병합이고 배포는 BLOCKED다.**
`WEBHOOK_SECRET_DECRYPT_KEYS_JSON`의 Compose API/Worker 전달은 여전히 미반영이다.
이전 도구 차단을 우회하거나 운영 DB, 키, 배포, Worker를 조작하지 않는다.

## 실제 실행 경로

`scripts/ci/eventing-preflight-e2e.mjs`가 기존 실제 Migration 순서로 원본 fixture를 만든다.
진단 정책 전 스키마에 서로 다른 Workspace의 targetless 예약 2개, Delivery와 Attempt 각 2개가 있다.
이 fixture의 기존 진단 원문은 정책 적용 전에만 존재하며 취소·대상 추정·backfill은 없다.

`scripts/ci/eventing-diagnostic-migration.mjs`는 같은 전용 DB에서 세 개의 별도 연결을 연다.
정확한 DB 이름 `atlas_eventing_preflight_test`, loopback URL, test 환경, 명시적 승인 flag,
자동 schema sync/Migration/logging 비활성 및 적용 이력 테이블 이름을 확인한다.
유일한 pending Migration이 `EnforceWebhookDiagnosticPolicy1788696000000`이 아니면 중단한다.

TypeORM의 실제 MigrationExecutor와 기존 Migration 클래스를 사용한다.
`transaction: all`은 저장소 `packages/database/src/migration-cli.ts`의 실제 모드와 같다.
Migration SQL을 복사하거나 수정하지 않고 fake 실행·가짜 이력 삽입도 사용하지 않는다.
각 테스트 연결의 lock timeout 1초, statement timeout 5초, idle transaction timeout 10초를 사용한다.
종료 시 timeout 설정을 reset하고 트랜잭션과 연결을 정리한다. Gate의 10분 제한은 유지한다.

## 인수 시나리오 6개

1. 첫 번째 테이블의 실제 SELECT 트랜잭션을 열고 Migration을 실행한다.
   pg_blocking_pids와 pg_locks에서 reader가 ACCESS EXCLUSIVE 획득을 막는 것을 관측해야 한다.
   SQLSTATE 55P03으로 중단한 후 모든 public table 데이터 해시, 제약, trigger, 적용 이력이 원래와 같아야 한다.
2. 두 번째 테이블의 reader로 같은 검사를 반복한다.
   첫 번째 테이블의 ACCESS EXCLUSIVE 잠금이 이미 획득됐고 두 번째에서 대기함을 확인한다.
   선행 진단 갱신과 첫 번째 CHECK 생성, Migration 이력까지 함께 원복돼야 한다.
   단순히 오류를 주입하거나 timeout만 보고 성공으로 처리하지 않는다.
3. reader를 해제한 뒤 실제 Migration을 정상 적용한다.
   각 테이블의 진단 본문·오류 필드만 고정 marker로 바뀌고 나머지 모든 필드는 보존돼야 한다.
   signed request body, ID, 상태, 시도 횟수, 버전, 시간과 Workspace 경계를 함께 대조한다.
   CHECK 4개는 validated 상태이고 적용 이력은 한 건이어야 한다.
4. Migration 이전에 연 SQL 세션/트랜잭션에서도 정책 확정 후 원문 저장은 거절돼야 한다.
   두 테이블의 본문·오류 필드를 각각 검사하고 정확한 CHECK와 SQLSTATE 23514를 확인한다.
   모두 ROLLBACK하며 데이터와 이력이 변하지 않아야 한다. 실제 구버전 Worker 검증은 아니다.
5. 실제 undoLastMigration으로 마지막 진단 정책만 되돌린다.
   CHECK만 제거되고 정리된 진단 원문은 되살아나지 않아야 한다.
   기존 target-required trigger는 계속 보존한다. 제약이 없는 틈에 원문을 다시 삽입하지 않는다.
6. 같은 실제 Migration을 다시 적용한다.
   CHECK와 단일 적용 이력이 복원되고 이미 안전한 Delivery/Attempt의 모든 필드와 xmin이 같아야 한다.
   이후 기존 Preflight의 post-policy 및 R05-H 전체 백업·복구 검사를 그대로 실행한다.

원복에서 삭제·재삽입된 마지막 Migration 이력의 내부 ID/sequence는 재사용을 요구하지 않는다.
기존 다른 Migration 이력은 전체 행을 대조해 보존하고, 대상 정책은 이름으로 정확히 한 건인지 확인한다.

## 증거와 한계

결과는 `tmp/r05g-preflight/diagnostic-migration-result.json`에 별도로 기록한다.
기존 `result.json`, `restore-result.json`, `restore-comparison.json`은 그대로 남는다.
원문 행·진단·SQL·키 대신 성공 시나리오, 관측한 잠금 종류, count와 checkout SHA만 기록한다.
실패 시 검사 단계와 고정 오류 분류만 출력하며 원본 예외를 외부로 다시 던지지 않는다.
DB 서비스 자체 로그의 설정은 변경하지 않았으며 합성 fixture 외 데이터는 사용하지 않는다.

단위검사는 격리·실행 승인·유일한 Migration·오류 비노출를 보조한다.
실제 DB의 여섯 시나리오와 별도로 보고하고, 실행 전 문서만으로 통과를 주장하지 않는다.

이 검사는 운영 규모의 소요시간, lock 예산, old Worker drain 또는 변경 창 승인이 아니다.
SQL reader도 DDL을 막을 수 있으므로 쓰기 중단만으로 Migration 창이 확보됐다고 판단하지 않는다.
긴 읽기 트랜잭션의 확인·종료 절차도 운영 담당자가 정해야 하며 도구가 세션을 강제 종료하지 않는다.
두 테이블을 하나의 트랜잭션으로 변경하더라도 이미 commit한 진단 원문 정리는 Down으로 복원되지 않는다.
`productionChanges`, `workerDrainVerified`, `productionLockBudgetVerified`,
`deploymentAuthorized`, `keyRetirementAuthorized`는 모두 false다.

관련 문서: `docs/operations/eventing-rollout-runbook.md`,
`docs/implementation/r05h-eventing-restore-rehearsal.md`.

공식 동작 근거:
https://www.postgresql.org/docs/17/explicit-locking.html
https://www.postgresql.org/docs/17/runtime-config-client.html
https://typeorm.io/docs/migrations/faking/
