# R05-H — 격리된 Eventing 논리 백업·복구 리허설

## 범위와 중단선

R05-G의 읽기 전용 Preflight와 운영 검토 문서는 유지한다.
기존 `Eventing Rollout Preflight Gate`에 복구 리허설을 추가한다.
새 Gate를 늘리거나 기존 테스트·Migration·제품 실행 정책을 변경하지 않는다.
R05-E/F의 인증 HTTP·Scheduler 브라우저 검증을 다시 구현하지 않는다.

**PR #31은 Draft·미병합이다. 운영 배포는 계속 BLOCKED다.**
`WEBHOOK_SECRET_DECRYPT_KEYS_JSON`의 Compose API/Worker 전달은 여전히 미반영이다.
복구 검사는 해당 설정의 우회·대체 구현이 아니며 운영 키를 읽거나 교체하지 않는다.
운영 DB, 실제 백업, Worker, Queue, 수신기 또는 MinIO에 접속하지 않는다.

## 재현 경로

`scripts/ci/eventing-restore-e2e.mjs`는 기존 R05-G의 성공 결과와 같은 checkout을 요구한다.
원본은 실제 Migration 순서를 통과한 전용 DB `atlas_eventing_preflight_test`다.
대상은 같은 CI PostgreSQL 서비스의 새 DB `atlas_eventing_restore_test`로 고정한다.
명시적 test flag, NODE_ENV=test, loopback, 포트 5432, atlas 역할과 서비스 container ID를 검사한다.
일반 DATABASE_URL은 복구 source로 자동 사용하지 않고 별도 test URL을 받는다.
Docker 서비스의 Workspace ID 목록이 loopback 연결과 같은지도 먼저 대조한다.
기존 대상 DB나 복구 대상의 사용자 객체가 있으면 중단하며 DROP/clean/overwrite하지 않는다.

업무 fixture는 실제 PublicationSchedulingService, PublicationScheduleProcessor,
ScheduledPublicationCommandService, ContentPublicationService로 발행과 effect receipt를 만든다.
실제 OutboxRelayService와 OutboxConsumerService로 성공 Consumer receipt·attempt·Audit를 남긴다.
Queue port는 메모리 notification collector다. Redis/BullMQ Worker나 실제 HTTP 전달 검증이 아니다.
기존 역사적 targetless 예약, Webhook signed request 및 안전한 진단 fixture도 함께 보존한다.

CI PostgreSQL 17 서비스에 포함된 실제 pg_dump/pg_restore를 사용한다.
Custom-format 전체 논리 dump를 만든 다음 빈 DB에 single-transaction·exit-on-error로 복구한다.
Data-only, table 필터, clean, disable-triggers, source 수정 Workflow는 사용하지 않는다.
트리거를 끄지 않고 정상 전체 schema/data/post-data 복구 후 활성 상태를 검증한다.
재암호화나 진단 원문 복원으로 성공시키지 않는다.

## 검사 계약

1. 빈 검증을 방지한다. 예약·Revision·Publication·effect receipt·Consumer receipt/attempt,
   Webhook 이력·Outbox·Audit가 실제로 존재해야 하며 targetless 예약 2개가 유지돼야 한다.
2. dump 전후 원본이 같고 archive가 native custom 형식인지 검사한다.
   모든 public table 행을 정렬된 JSON text의 SHA-256 및 행 수로 대조한다.
   Sequence last_value/is_called, constraint 정의/validation, index 정의,
   사용자 trigger 정의/enabled 상태도 양 DB에서 대조한다.
3. 성공 receipt를 복원한 뒤 실제 Schedule Processor/Consumer를 중복 호출해
   DB 상태·Audit·시도·발행이 변하지 않고 Consumer가 duplicate/effects=0인지 검사한다.
4. 복구된 target-required trigger가 새 targetless INSERT를 거절하고,
   진단 CHECK가 임의 response excerpt를 거절하는지 실제 DB에서 확인한다.
   실패한 검사 트랜잭션은 ROLLBACK하며 과거 예약 target을 UPDATE하지 않는다.
5. 메모리에서 만든 테스트 키로 암호화한 비활성 Endpoint도 복원한다.
   새 Cipher 인스턴스가 보존된 원래 키로만 복호화할 수 있어야 한다.
   해당 version이 없거나 같은 version의 bytes가 다른 키는 거절돼야 한다.
   Ciphertext·version 보존을 검사할 뿐 운영 key coverage나 key 폐기 승인이 아니다.
6. 복구된 legacy Workspace의 실제 Preflight가 unresolved 집계와 diagnostic policy 적용을 유지하고
   deploymentAuthorized/keyRetirementAuthorized=false를 반환하는지 검사한다.
7. 백업 이후 원본에만 새 fixture Event를 추가한다. 복구본에 없는 것을 확인해
   논리 백업이 그 이후의 이벤트나 receipt를 보장하지 않는다는 시점 한계를 명시한다.

안전 guard 단위검사는 `scripts/ci/eventing-restore-guard.test.mjs`에 있다.
복구를 시작하기 전 URL/역할/포트/flag/container ID/빈 대상/명령 옵션을 확인한다.
단위검사는 실제 PostgreSQL 리허설의 대체 근거가 아니다.

## 증거와 운영 적용의 구분

실행 결과는 같은 Gate artifact의 `restore-result.json`에 저장한다.
성공한 시나리오, checkout SHA, 비교 대상 수, archive 크기·해시만 기록한다.
기존 R05-G의 `result.json`과 formatting diff도 계속 보존한다.
Archive는 작업 공간·artifact 경로 밖의 0700 임시 디렉터리와 0600 파일로 만들고 finally에서 삭제한다.
DB 원문/비밀정보/키/ciphertext/원시 client stderr/stack과 archive 자체를 업로드하지 않는다.

이 검사는 합성 fixture의 PostgreSQL 논리 복구다. 실제 운영 백업을 시험한 것이 아니다.
Owner/ACL/global role/tablespace 복구, WAL/PITR, Redis·MinIO 복구, 운영 처리량의 RTO/RPO,
진단 Migration의 실제 lock 소요시간, 전체 Writer drain과 키 보존 기간은 확인하지 않는다.
백업 이후 이력을 잃은 상태에서 외부 요청의 exactly-once를 보증하지 않는다.
운영 담당자의 복구본 리허설·키 보존·중복 전달·변경 창 승인은 별도로 남는다.

관련 문서: `docs/operations/eventing-rollout-runbook.md` 및
`docs/implementation/r05f-scheduler-acceptance.md`.

PostgreSQL 17 공식 동작:
https://www.postgresql.org/docs/17/app-pgdump.html
https://www.postgresql.org/docs/17/app-pgrestore.html

## 비교 기준의 보정과 실패 이력

첫 fixture의 disabled Endpoint INSERT는 기존 Repository가 disabledAt을 null로 저장하므로
DB 제약에서 거절됐다. 같은 트랜잭션 안에서 active 생성 후 기존 versioned 상태 변경 메서드로
disabled 전환하도록 수정했다. 제품 코드·DB 제약·trigger는 변경하지 않았다.

실제 논리 복구에서 전체 테이블/sequence/trigger는 일치했으나 72 CHECK 정의와
4 partial index 정의의 문자열 비교가 달랐다. role/status의 기존 배열 전체 캐스트는
복구 후 원소별 캐스트로 역변환됐으며 공개 Migration의 문자열과 해시로 이를 확인했다.
pg_get_constraintdef/pg_get_indexdef는 원래 SQL이 아니라 내부 식을 역변환한 텍스트다.

`scripts/ci/eventing-restore-schema.mjs`는 PostgreSQL이 반환한 CHECK/partial predicate를
동일 DB의 임시 view에서 PostgreSQL 자체로 재파싱한다. 두 번 역변환한 결과의 고정점을 확인하고
이를 비교한다. 정규식으로 cast/literal/operator를 삭제하거나 DB 객체를 변경하지 않는다.
임시 view만 생성하며 SELECT를 실행하지 않고, 별도 트랜잭션은 항상 ROLLBACK한다.
제약의 나머지 정의, validation/deferrability/no-inherit와 인덱스의 나머지 정의는 그대로 비교한다.
실제 DB에서 허용값이나 연산자가 달라지면 비교 결과도 달라지는 대조 검사를 추가했다.

진단 artifact `restore-comparison.json`은 차이가 난 경로와 문자열 해시만 보존하며
테이블 원문이나 schema 표현식 원문을 기록하지 않는다. 비교가 실패하면 Gate도 계속 실패한다.
공식 함수 계약: https://www.postgresql.org/docs/17/functions-info.html
