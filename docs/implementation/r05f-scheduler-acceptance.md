# R05-F — Legacy Schedule HTTP와 Scheduler 집중 인수

## 범위와 기준

PR #31 (`feat/outbox-webhook-scheduling` → `develop`)의 R05-E 후속 검증이다.
R05-E의 Consumer/예약 Operator HTTP Gate와 기존 R03 실행/DB 검증은 유지한다.
이 문서의 새 HTTP Gate는 기존 Operator Gate를 대체하지 않는다.

시작 시 Feature Head `11e9305633530eea26208ac63655ab6c1191f478`,
실제 develop ref `20f3d718d0e1d551025158eadbe68f2850c4f503`와 12개 성공 PR Workflow를 확인했다.
PR metadata의 base SHA 대신 실제 `git/ref/heads/develop`을 기준으로 삼았다.

## A. 실제 Migration으로 보존한 legacy 예약의 인증된 HTTP

- `.github/workflows/scheduler-legacy-http.yml`
- `scripts/ci/scheduler-legacy-http-e2e.mjs`

`NODE_ENV=test`, 명시적 테스트 허용 flag, loopback DB 주소, 정확한 전용 DB 이름
`atlas_scheduler_legacy_http_test`, 빈 public 스키마를 모두 검사한다.
운영 DB 또는 이미 사용 중인 테스트 DB에서는 실행을 거부한다.

실제 Migration 목록을 순서대로 읽고
`1788664800000-CreatePublicationScheduleEffects` 직전까지만 먼저 적용한다.
이 상태에서 실제 Repository로 targetless pending publish/withdraw,
실패 이력과 attempt가 있는 failed publish, 다른 Workspace의 pending을 만든다.
나머지 실제 Migration을 모두 적용한 뒤 원래 Schedule 행·Audit·Outbox snapshot이
변하지 않았는지 비교한다. Migration 이력의 실제 이름과 순서, pending 없음도 검사한다.

새 targetless INSERT가 활성 상태의 실제 target 제약 trigger에서 거절되는지도 확인한다.
trigger를 끄거나 target을 강제 UPDATE하지 않는다. READY/ACTIVE 현재 포인터가 있더라도
과거 예약은 unresolved 상태를 유지하며 새 예약만 명시적 새 ID와 현재 검증된 대상을 가진다.

OWNER/VIEWER는 실제 Argon2id Password → TOTP 등록/확인 → Grant → Session을 HTTP로 수행한다.
Session, MFA Method, Grant, CSRF를 직접 DB에 주입하지 않는다.
실제 PostgreSQL, Redis, 빌드한 NestJS API를 사용하며 Worker는 시작하지 않는다.

### 검사 조건

1. 전체 실제 Migration 적용 후 legacy target·행·Audit·Outbox 보존.
2. 활성 trigger가 신규 targetless INSERT 거절.
3. OWNER/VIEWER의 실제 인증 흐름과 현재 Workspace 확인.
4. READY/ACTIVE 변경에도 안전한 unresolved 응답과 lifecycle eligibility 유지.
5. 익명·VIEWER·누락/불일치 CSRF·잘못된 version/type의 취소 거절 및 무효과.
6. Workspace 및 Content/ContentSite 조합 경계에서 조회·취소·생성 차단.
7. open legacy 예약이 있으면 새 예약 생성 409.
8. 권한 있는 취소, Audit 1회, 동일 요청 멱등성과 원래 target·이력 유지.
9. 취소 후 새 예약도 인증·Permission·CSRF 적용.
10. publish 재생성은 새 ID와 현재 READY Revision을 고정.
11. withdraw 재생성은 새 ID와 실제 ACTIVE Publication을 고정.
12. failed legacy의 cancel/retry는 409이며 원래 실패와 attempt 이력을 유지.
13. failed legacy를 수정하지 않고 별개의 새 예약 생성.

취소 row와 해당 Audit의 PostgreSQL `xmin`을 비교하여 같은 트랜잭션에서 확정되었는지 검사한다.
멱등 요청 이후 version·Audit가 추가로 변하지 않아야 한다.
거절된 요청은 해당 Scope의 Schedule/Publication/effect 및 legacy Audit/Outbox snapshot을 바꾸지 않아야 한다.

### 확인한 실행

Feature Head `4b695e321a4539fc92653125a11e761ae1326854`에 연결된 PR Workflow
`34320494951`에서 **22개 Migration, 13개 시나리오, 47회 HTTP 요청이 성공**했다.
Artifact `10091681984`의 result.json과 빈 format.patch를 확인했다.
이는 PR synthetic merge 검사이며 운영 실행, 실제 develop 병합 또는 Worker 실행 증거가 아니다.

첫 추가 커밋의 검사 중 Audit 비교 SQL에서 varchar/uuid 타입 불일치를 발견했고,
`a.target_id=s.id::text`로 쿼리를 수정한 다음 모든 원래 assertion을 통과했다.
같은 커밋의 포맷 차이는 저장소 Prettier 출력대로 수정했다.

## B. Scheduler 집중 브라우저

- `.github/workflows/scheduler-browser.yml`
- `scripts/testing/browser/scheduler_browser.py`
- `scripts/testing/browser/scheduler_fixture.py`
- `scripts/testing/browser/test_scheduler_fixture.py`

기존 develop의 Playwright와 loopback fixture 기반을 재사용한다.
새 라이브러리, lockfile 변경, 애플리케이션의 테스트용 auth bypass나 test route는 없다.
기존 Content Editor Browser Regression과 별도 Workflow이며 그 성공으로 이 검사를 대체하지 않는다.
기존 브라우저 기반 파일은 develop에 있으므로 이 Feature의 PR synthetic merge가 검증 기준이다.

실제 production build한 Next.js Scheduler를 Chromium에서 조작한다.
브라우저 suite의 API/Auth/DB는 loopback fixture이고, fixture 전용 cookie/CSRF를 사용한다.
서버 응답 지연·실패·409·현재 포인터 변경을 fixture로 제어한다.
실제 인증·DB Migration·취소·생성은 A가 검증하며, 두 suite를 하나의 실제 full-stack 브라우저 인증 흐름으로 표현하지 않는다.

### 제품 변경

Scheduler는 목록 조회가 확인되기 전 또는 조회 실패 후 생성·취소·재시도를 허용하지 않는다.
React state 갱신 이전 같은 이벤트 턴의 중복 클릭도 동기 request ref로 막는다.
요청 중 입력과 다른 action을 잠그고, 성공·거절·불명확한 응답 뒤 목록을 갱신한다.
409는 상태 변경 안내와 최신 목록을 보여주며 변경 요청 자체를 자동 재전송하지 않는다.
생성 성공 후 reload가 실패하더라도 서버의 생성 영수증 메시지를 보존하고 추가 쓰기를 차단한다.
Workspace/Content/ContentSite가 바뀌면 별도 keyed Panel로 이전 Scope 상태를 재사용하지 않는다.

고정 대상 직렬화/판정과 기존 한국어 targetless 안내는 그대로 사용한다.
추가한 최소 너비/줄바꿈 CSS와 labelled region, aria-controls/aria-busy, polite live status를 검사한다.
중첩 Content/Publication Grid와 모바일 AdminShell도 축소 가능하게 조정했다.
AdminShell의 모바일 열은 `minmax(0, 1fr)`이며 Sidebar의 가로 메뉴 스크롤은 유지한다.

### 검증 설계와 증거

14개 브라우저 검사는 publish/withdraw 고정 대상 유지, legacy pending 취소·재생성,
failed legacy 보존, 생성·취소·재시도 중복 요청 1회, processing 중 생성 차단,
초기 조회 대기/실패, 409 reload, 성공 후 조회 실패, validation 오류의 입력 보존,
키보드 조작과 live status, 1440/375/320px의 전체 UUID·overflow를 각각 검사한다.
fixture HTTP 계약 검사는 별도의 4개 unittest다.

각 검사마다 실제 Panel PNG, DOM/ARIA snapshot, fixture의 요청 및 응답 상태,
Playwright trace를 저장한다. 실행 결과에는 checkout SHA와 테스트 대상 소스 SHA-256을 남긴다.
스크린샷을 확보하고 실제 검토하기 전에는 시각 인수 완료로 보고하지 않는다.

### 확인한 브라우저 실행과 시각 검토

Feature Head `a273df7b7b8ad8157a84ef9e4a1d3d3c1baa198d`의 PR Workflow
`34323245585`, Job `102374485851`에서 **브라우저 14/14, fixture 계약 4/4가 성공**했다.
Browser result의 failure/error/skip은 모두 0이다.
실제 checkout은 PR synthetic merge `2ce85d2103e344edbaf14983e6aca580be01766d`였다.

Artifact `10092734418`에는 PNG 17개, DOM/ARIA/fixture snapshot 17개와 trace 14개가 있다.
1440/375/320px의 실제 PNG를 열어 고정 UUID와 Schedule ID의 전체 표시 및 줄바꿈을 확인했다.
Failed legacy의 재실행 버튼 미노출과 별도 새 예약 표시도 PNG/DOM으로 확인했다.
17개 전체 PNG를 수동으로 전부 평가했다는 의미는 아니며 자동 DOM/레이아웃 검사는 전체 suite에 적용된다.

초기 실행의 Action 선택자는 implicit label 전체 텍스트와 정확히 일치하지 않았다.
실제 ARIA의 `combobox` 이름은 `Action`으로 정상이었으므로 정확한 role/name 선택자로 수정했다.
키보드 focus/Enter/Tab assertion은 유지했다.
좁은 화면 검사는 실제 가로 넘침을 발견했으며 Content Grid 수정만으로 해결되지 않았다.
최종 AdminShell 수정 후 동일한 375/320px 화면 경계와 자식 overflow assertion을 통과했다.
조건을 완화하거나 검사·skip으로 실패를 숨기지 않았다.

여기에 기록한 실행은 명시된 Head의 증거다. 후속 커밋은 해당 최신 Head의 전체 PR Workflow를
다시 확인해야 한다. 이 문서의 추가 자체가 후속 Head의 CI 성공을 미리 보증하지 않는다.

## 배포 및 인수 경계

`WEBHOOK_SECRET_DECRYPT_KEYS_JSON`의 Compose API/Worker 환경 변수 전달은 여전히 미반영이다.
이전 도구 안전성 차단을 다른 write 경로로 우회하지 않았으며, 여러 키 Compose 배포 blocker를 유지한다.
활성 암호화 키만 교체해서는 안 된다.

이 작업은 격리된 CI와 Feature branch의 일반 커밋에 한정한다.
운영 Migration, Worker drain, 운영 예약 쓰기 중단/재개, 키 교체·폐기, 배포를 실행하지 않았다.
운영 적용 전에는 old Worker drain, 쓰기 중단/재개, 키/백업 복구,
비가역 Webhook 진단 정리 Migration의 lock 예산 및 rollback 제한을 별도로 승인해야 한다.
최신 Head 전체 Gate와 남은 인수 조건이 확인될 때까지 PR #31은 Draft·미병합으로 유지한다.
