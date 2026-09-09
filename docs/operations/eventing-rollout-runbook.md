# R05-G — Eventing 운영 전 점검과 조율된 rollout 검토

## 현재 상태와 중단선

이 문서는 운영 실행 명령서가 아니라 운영 전 인수 검토 기준이다.
시작 Feature Head는 `a43d7408d3af4d7a71e8833e31f6cdcc7479a657`,
실제 develop은 `20f3d718d0e1d551025158eadbe68f2850c4f503`이다.
R05-F까지 완료한 Legacy HTTP와 Scheduler 브라우저 검사를 다시 구현하지 않는다.

**현재 배포 판정은 BLOCKED다. PR #31은 Draft·미병합으로 유지한다.**
`WEBHOOK_SECRET_DECRYPT_KEYS_JSON`의 Compose API/Worker 전달은 미반영이다.
이 문서와 preflight는 해당 설정을 수정하거나 대체 경로로 전달하지 않는다.
이전 도구 안전성 차단을 우회하는 override, 환경 변수 주입 도구, 소스 수정 Workflow를 만들지 않는다.
현재 활성 키를 먼저 바꾸지 않는다.

운영 Migration, 키 교체·폐기, Worker 중지, 쓰기 차단, 배포는 이번 변경에서 실행하지 않는다.
CI 성공과 아래 점검의 성공은 운영 적용 승인이나 전체 fleet 안전성 증거가 아니다.

## 1. 읽기 전용 DB 사전점검

새 도구: `scripts/operations/eventing-rollout-preflight.mjs`.
기존 `webhook-encryption-key.mjs inspect`의 key inventory를 재구현하지 않는다.
새 도구는 복호화 키 없이 한 Workspace의 다음 집계만 반환한다.

- Schedule 전체/pending/processing/failed 수와 세 target 필드가 모두 null인 수.
- Webhook Delivery/Attempt의 전체 수 및 진단 정리 Migration의 변경 대상 행 수.
- 진단 정책 Migration의 적용 여부와 **전체 테이블** 물리적 크기.

실행 전 운영자가 접근 대상과 읽기 권한을 별도로 승인해야 한다.
일반 `DATABASE_URL`을 사용하지 않고 명시적 `ATLAS_EVENTING_PREFLIGHT_DATABASE_URL`만 읽는다.
접속 정보는 승인된 환경 주입으로 제공하며 명령 인자, 문서, Git, 로그에 넣지 않는다.

```bash
node scripts/operations/eventing-rollout-preflight.mjs --help
node scripts/operations/eventing-rollout-preflight.mjs --workspace <workspace-uuidv7>
```

도구는 한 전용 연결에서 REPEATABLE READ와 READ ONLY를 설정한 뒤 SELECT만 실행하고
성공/실패 모두 ROLLBACK한다. schema sync, Migration 실행, Queue, HTTP, 재암호화, Audit 쓰기는 없다.
lock timeout은 1초, 각 statement timeout은 5초, idle transaction timeout은 10초다.
이는 각 SQL의 예산이며 명령 전체의 고정 실행시간 보장은 아니다.
인덱스가 없는 COUNT는 부하를 줄 수 있다. 읽기 전용도 read lock을 가지므로 한 Workspace씩 실행한다.
시간 초과 시 결과를 완전한 성공으로 취급하거나 자동으로 예산을 확대하지 않는다.

연결에는 대상 표의 SELECT와 스키마 USAGE만 허용하는 전용 역할을 권장한다.
도구는 역할을 생성하거나 권한을 부여하지 않는다. Query 실패 시 원문 SQL·값·stack을 출력하지 않는다.
존재하지 않는 Workspace 또는 필요한 스키마가 없는 DB는 실패하며 빈 정상 보고서로 바꾸지 않는다.
Phase 9의 Schedule target 열과 Webhook 테이블 및 `atlas_migrations`가 있는 public 스키마가 전제다.
그 이전 DB에서는 승인된 별도 호환성 검토가 필요하며 도구가 자동 Migration을 수행하지 않는다.

수치는 64비트 count 정밀도를 보존하도록 십진 문자열이다.
진단 원문, signed request body, ciphertext, endpoint URL/ID, 키 값은 출력하지 않는다.
현재 포인터에서 과거 Schedule target을 추정하거나 null을 채우지 않는다.
`missing_target`은 모두-null 집계일 뿐 모든 invalid/mixed target을 판정하는 실행 validator가 아니다.
전체 테이블 크기는 Workspace별 값이나 트랜잭션 snapshot에 고정된 물리 크기라고 해석하지 않는다.

결과는 항상 `assessment=inventory-only`, `deploymentAuthorized=false`,
`keyRetirementAuthorized=false`다. processing=0 한 번 관측한 것으로 프로세스 drain을 보증하지 않는다.
키 bytes의 정확성, 전체 Workspace key coverage, Compose 전달, backup 복구, 실제 lock 소요시간은
검사하지 않는다. API/Worker readiness나 수신기 전달 확인을 대신하지 않는다.

## 2. 변경 창을 열기 전에 필요한 증거

| 항목 | 필요한 증거 | 현재 상태 |
|---|---|---|
| 소스/CI | 최신 Head, 실제 develop, 동일 Head 전체 Gate, 승인된 배포 artifact 식별자 | 매 변경마다 재확인 |
| Compose key 전달 | 정식 허용된 수정과 API/Worker 다중 키 전달 검증 | BLOCKED — 미반영 |
| Writer inventory | 모든 API/Worker/CLI/예약 writer의 버전, 인스턴스, 종료 확인 방법 | 운영 확인 필요 |
| 쓰기 중단 | 생성/취소/retry/replay/publish/withdraw/키 변경의 진입 경로와 중단 담당자 | 운영 확인 필요 |
| Backup/restore | 격리 복구 결과, 보존 키 inventory, signed body/receipt/이력 보존 | 운영 확인 필요 |
| Migration 예산 | 두 진단 테이블 크기와 변경 행 수, 복구본에서 측정한 시간, lock/중단 예산 | 운영 확인 필요 |
| Rollback | 새 키 ciphertext 발생 이후 구버전 복귀 제한, 비가역 진단 정리의 승인 | 운영 확인 필요 |

운영 담당자, 변경 창, 승인자, 근거 artifact, 중단 조건을 기록하지 않은 항목은 완료로 표시하지 않는다.
CI에서 만든 `.next`와 fixture API가 주입된 브라우저 build는 운영 artifact로 재사용하지 않는다.
모든 미완료 항목과 Compose blocker가 해결되기 전에는 아래 절차를 실행하지 않는다.

## 3. 승인 이후의 순서 — 아직 실행하지 않은 절차

1. 승인된 변경 창에 모든 예약/발행/키 writer의 새 요청 접수를 멈춘다.
   숨겨진 drain API나 maintenance flag가 있다고 가정하지 않는다.
   실제 ingress/supervisor의 검증된 제어 방법과 예외 경로를 운영자가 지정해야 한다.
2. 기존 Worker의 새 claim을 멈추고 in-flight 작업의 종료 또는 명시적 실패 상태를 확인한다.
   프로세스 목록·버전·종료 로그와 DB snapshot을 함께 확인한다.
   timeout, lease 만료 또는 DB processing=0만으로 old writer가 사라졌다고 판단하지 않는다.
3. old writer가 종료된 상태에서 검증한 복구본의 Migration/lock 예산을 재확인한다.
   예약 target-required trigger를 끄거나 실패한 예약을 대량 취소·수정하지 않는다.
   진단 정리 Migration이 외부 진단 원문을 영구 제거한다는 사실을 승인 기록에 남긴다.
4. 별도 승인된 Migration과 호환 binary/config rollout을 수행한다.
   API/Worker 전체에서 keyring을 사용할 수 있어야 하며 기존 활성 키는 유지한다.
   혼합된 구형 single-key writer에 새 키 ciphertext를 노출하지 않는다.
5. 기본 기능·인증·CSRF·Scope·Schedule target과 receipt 보존을 확인한 후 쓰기/worker 재개를 승인한다.
   현재 R05-E/F의 검증 범위와 실제 배포 후 smoke test를 구분한다.
6. Storage encryption key 전환은 별도 변경이다. 이전 키를 read 가능하게 유지하고
   승인된 `webhook-encryption-key.mjs`의 작은 Workspace 배치와 Audit를 확인한다.
   `changed=0`은 SKIP LOCKED일 수 있으므로 전체 inventory를 다시 확인한다.
7. 전체 DB 참조 0, in-flight snapshot/old process 부재, backup 보존 기간 및 복구 가능성이
   모두 확인되기 전에는 이전 키를 제거·폐기하지 않는다.

이것은 저장 암호화 키 회전이며 외부 수신기 HMAC signing Secret 회전이 아니다.
기존 w1/AAD, endpoint version/updatedAt, 서명 원문과 이력 보존 계약을 유지한다.

## 4. 중단과 rollback 제한

Scope/CSRF 위반, target 변화, 중복 receipt/Audit, 원문 진단 노출, key coverage 실패,
예산 초과 또는 old writer 미확인은 중단 사유다. 테스트 완화, trigger 비활성화,
과거 target backfill이나 key version 재사용으로 계속 진행하지 않는다.

`1788696000000-EnforceWebhookDiagnosticPolicy`의 down은 CHECK 제약만 제거한다.
이미 제거한 진단 원문은 되살릴 수 없고, 원문을 다시 주입하는 rollback을 만들지 않는다.
백업 복구도 시점 이후 정상 변경·receipt를 잃고 외부 Webhook을 중복 전송할 수 있으므로
별도 복구 계획과 수신기 중복 처리 검토 없이는 수행하지 않는다.
새 키가 쓰인 후 구형 single-key binary로 단순 복귀하지 않는다.

## 5. 검증과 근거

`Eventing Rollout Preflight Gate`는 전용 빈 DB `atlas_eventing_preflight_test`에서
실제 Migration을 target-required 전, 진단 정책 전, 최종 스키마 순으로 적용한다.
과거 targetless 예약과 진단 fixture를 올바른 과거 시점에 만들며 trigger를 비활성화하지 않는다.
preflight 호출 전후의 Schedule/Delivery/Attempt/Endpoint/Event/Audit snapshot을 비교한다.
실제 DB READ ONLY write 거절, Workspace 격리, 알 수 없는 Workspace, table lock timeout,
정책 적용 후 후보 0과 signed request 보존 및 실제 CLI 실행도 검사한다.

단위검사는 transaction 순서와 오류 경계를 보조한다. 실제 DB 검증은 위 Gate이며
운영 실행이나 fleet/backup/Compose 검증을 했다고 주장하지 않는다.

관련 계약:
`docs/implementation/r03-scheduled-publication-effects.md`,
`docs/implementation/r05c-webhook-transport-safety.md`,
`docs/implementation/r05d-webhook-key-rotation.md`,
`docs/implementation/r05f-scheduler-acceptance.md`.

PostgreSQL 트랜잭션 규칙: https://www.postgresql.org/docs/17/sql-set-transaction.html
