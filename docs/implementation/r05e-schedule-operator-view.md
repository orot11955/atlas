# R05-E — Pinned Schedule targets and operator views

Schedule list/create/cancel/retry responses now use an explicit allow-list instead
of spreading an internal record. The persisted Revision ID/number or Publication ID
is returned as a discriminated target, with nullable legacy target fields retained.
The view calls the same target validator used by execution. Missing targets and
invalid/mixed targets are represented as unresolved, never filled from current
Content or Publication pointers. Unknown internal fields and raw exception messages
are not returned; failed execution diagnostics use a fixed message and failure code.

The operations object describes lifecycle eligibility, not permission. Pending
records can be cancelled, including legacy unresolved records. Only failed records
with a valid pinned target advertise retry. Existing Session, Workspace, CSRF and
permission guards and transactional command validation remain authoritative. This
slice changes no lifecycle mutation, target, Migration or Publication snapshot.

The Admin Scheduler displays the pinned target and its full identity, Schedule ID,
attempt count and guidance. It explains that later READY pointers do not replace a
publish target and that withdrawing an inactive old Publication does not withdraw a
new one. Unresolved pending rows offer cancellation and recreation guidance; failed
legacy rows do not offer retry and retain their history. Older responses without the
new contract do not enable retry by guessing. Open work prevents a new schedule in
the UI, matching the existing database uniqueness rule. A successful creation shows
the server-confirmed target, not an optimistic client-side assumption.

New server-view and frontend presentation tests cover target types, every lifecycle
state, missing/invalid targets, contradictory presentation inputs and error/internal
field exclusion. Existing Publication effect/ownership/schema gates remain mandatory.
No automated database backfill, bulk cancellation, deletion or inferred target repair
is introduced. Operator acceptance requires real authenticated HTTP coverage as well
as the model tests; browser visual acceptance is distinct from pure presentation tests.

Remaining Phase 9 blockers include Compose decrypt-key forwarding, Consumer HTTP
operator acceptance and coordinated rollout checks. Keep PR #31 Draft; a green view
contract is not production deployment approval.
