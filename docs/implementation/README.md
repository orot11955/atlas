# Atlas 구현 문서

Atlas 구현은 아래 문서를 기준으로 진행한다.

1. [전체 구현 로드맵](../implementation-roadmap.md)
   - 구현 순서, Milestone, Phase별 결과와 권장 PR 순서
2. [Phase별 구현 체크리스트](phase-checklists.md)
   - Entity, API, Admin UI, Worker, Test와 완료 조건
3. [구현 아키텍처 결정](architecture-decisions.md)
   - ContentDraft, Publication, API Key, Outbox, Audit와 코드 경계
4. [Acceptance와 Release Gate](acceptance-gates.md)
   - 보안 Gate, 위험 기반 Definition of Done과 핵심 시나리오

구현 중 문서가 충돌하면 다음 우선순위를 적용한다.

```text
최신 ADR 또는 구현 아키텍처 결정
→ 전체 구현 로드맵
→ Phase별 체크리스트
→ 기존 플랫폼 설계 초안
```

현재 다음 작업은 `Phase 1. Server Boundary & Platform Kernel Lite`다.

```text
packages/server 생성
→ API와 Worker 공유 경계 확정
→ Request Context
→ Problem Details
→ Transaction Runner
→ 최소 Audit
→ Logging과 Redaction
```
