# R05-E — Pinned Schedule targets and authenticated operator boundaries

## Read model and UI

Schedule list/create/cancel/retry responses now use an explicit allow-list instead
of spreading an internal record. The persisted Revision ID/number or Publication ID
is returned as a discriminated target, with nullable legacy target fields retained.
The view calls the same target validator used by execution. Missing targets and
invalid/mixed targets are represented as unresolved, never filled from current
Content or Publication pointers. Unknown internal fields and raw exception messages
are not returned; execution diagnostics use a fixed message and failure code.

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

Twenty-three server-view and ten frontend presentation tests cover target types,
every lifecycle state, missing/invalid targets, contradictory presentation inputs and
error/internal field exclusion. Existing Publication effect/ownership/schema gates
remain mandatory. No automated database backfill, bulk cancellation, deletion or
inferred target repair is introduced.

## Authenticated HTTP acceptance

The permanent Eventing Operator HTTP Gate builds the actual API and packages and
applies real migrations to a dedicated disposable PostgreSQL database. Redis is real;
no Worker is started, so committed Replay state can be inspected before execution.
The script refuses non-loopback/non-test URLs and a database with existing accounts.

The suite seeds account identities with real Argon2id password hashes and domain
fixtures. It does not insert Sessions, CSRF tokens, MFA methods or authentication
grants. Both OWNER and VIEWER complete actual Password login, TOTP enrollment and
confirmation, grant exchange and Session creation through HTTP. All subsequent
operator commands use the resulting cookies against the running production API.

Thirteen scenarios cover authentication; anonymous rejection; VIEWER read-only
access; missing/mismatched CSRF; cross-Workspace isolation; DTO bounds and optimistic
conflicts; rejection of successful or invalid-contract Consumer replay; a successful
Replay preserving immutable Event and attempt history with exactly one Replay Audit;
idempotency and conflicting Replay IDs; safe history responses; exact READY target
creation/listing; guarded, versioned and idempotent schedule cancellation; and exact
active Publication identity in a withdrawal schedule. Refused commands are checked
against durable state, not only HTTP status. Logs do not echo authentication bodies.

Terminal Consumer fixtures use the actual claim/finish Repository to build attempt
history. This is deliberate fixture setup, not a claim that five queue executions
were observed. Existing Consumer/BullMQ suites separately test later processing.
The HTTP suite does not exercise a targetless historical Schedule: its readable view
and operation hints are tested with model fixtures, while the retained R03 migration
and effect suite covers actual legacy-row preservation and execution rejection.
End-to-end historical cancellation and focused Scheduler browser/visual acceptance
remain separate follow-up work. No database trigger is disabled to create fixtures.

## Remaining rollout boundaries

Compose decrypt-key forwarding remains unimplemented. The new Schedule panel still
needs focused browser acceptance, including legacy-row actions; existing broad
browser regressions do not establish that coverage. Coordinated process draining,
backup/key retirement and the non-restorative diagnostic migration require explicit
operational review. Keep PR #31 Draft; passing code and HTTP gates does not authorize
production migration, key rotation or deployment.
