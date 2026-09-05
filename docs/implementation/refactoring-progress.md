# Refactoring implementation ledger

## R00-A — recursive test discovery

Merged through PR #32 after the exact feature head passed CI, Migration,
Resource Member Data Gate and Media Data Gate. Nine workspaces share the
recursive runner. Explicit zero-file entries are not a coverage claim.

## R01 — serialized Content Draft changes

Implemented in PR #33, separately from Phase 9. The coordinator preserves newer
edits, advances acknowledged server versions, serializes writes, reserves
exclusive Revision operations, and pauses writes after conflicts or ambiguous
failures. Only confirmed pre-commit validation errors can resume after editing.

Local checks: 35 Admin Web unit tests, 5 discovery regressions and 7 loopback
fixture contract tests passed. Offline compilation used Node 22 and TypeScript
5.8, not the production toolchain. The four isolated Chromium coordinator cases
are not the Next.js UI acceptance test.

### Browser evidence

The first real Next.js production UI run, 33959145329, passed all seven Chromium
cases against an isolated loopback HTTP API fixture on source head
`27bb73510a6a5bce45293d6243b4182237f73957`. It verified save/edit races, READY
ordering and duplicate prevention, conflict input preservation, validation
correction, SPA lifecycle isolation and archive ordering. This older run is
historical evidence only and cannot validate subsequent commits.

The permanent browser workflow now shows readable formatting differences without
modifying repository files. Content feature changes also trigger Media Data Gate
so editor and Asset integration changes cannot silently omit that regression gate.

### Acceptance and remaining work

PR #33 records the final accepted head and individual workflow runs. Before merge,
CI (quality and migration), Resource Member Data Gate, Media Data Gate and Content
Editor Browser Regression must all succeed for that head. After merge, verify the
same four workflows again on the resulting develop commit. A successful runner
working tree or a prior run is not proof that another commit passed.

The browser gate exercises the real Next.js UI, but API, authentication and
database behavior are simulated. Existing real data gates remain mandatory.
Fixture-configured builds must never be deployed; rebuild with production settings.

R00-B and R02 onward remain separate work. Phase 9 PR #31 is not completed by
this change. No production deployment is performed by these changes.
