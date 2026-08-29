# Atlas 구현 문서

Atlas 구현은 아래 문서를 기준으로 진행한다.

1. [전체 구현 로드맵](../implementation-roadmap.md)
   - 구현 순서, Milestone, Phase별 결과와 권장 PR 순서
2. [구현 진행 현황](progress.md)
   - 완료된 Phase와 다음 구현 단위
3. [Phase별 구현 체크리스트](phase-checklists.md)
   - Entity, API, Admin UI, Worker, Test와 완료 조건
4. [구현 아키텍처 결정](architecture-decisions.md)
   - ContentDraft, Publication, API Key, Outbox, Audit와 코드 경계
5. [Acceptance와 Release Gate](acceptance-gates.md)
   - 보안 Gate, 위험 기반 Definition of Done과 핵심 시나리오

구현 중 문서가 충돌하면 다음 우선순위를 적용한다.

```text
최신 ADR 또는 구현 아키텍처 결정
→ 전체 구현 로드맵
→ Phase별 체크리스트
→ 기존 플랫폼 설계 초안
```

현재 `Phase 1. Server Boundary & Platform Kernel Lite` 구현을 완료했으며 다음 작업은 `Phase 2. Admin Identity & Shell`이다.

```text
AdminAccount, Role, Permission
→ OWNER Bootstrap CLI
→ Password Login
→ TOTP MFA
→ Admin Session과 CSRF
→ Permission Guard
→ Login UI와 Admin Shell
```
