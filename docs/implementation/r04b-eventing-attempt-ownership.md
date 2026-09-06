# R04-B — Eventing execution ownership

## Status

Implementation candidate for PR #31. Acceptance requires the latest source Head
to pass the full repository checks and the permanent PostgreSQL ownership gate.
Previous R04-A green runs and local helper checks do not establish R04-B acceptance.
The PR remains Draft until the separate integration blockers below are resolved.

## Scope

Outbox dispatch/failure requires the event ID, Workspace and monotonically increasing
attempt captured by the claim. Consumption ownership additionally binds the receipt
ID and consumer key. Webhook completion binds Delivery, Workspace, Endpoint, Attempt
ID and attempt number. Null, incomplete and invalid owners fail closed. A stale
owner returns false without changing state or recording lifecycle Audit.

All ownership mutations require an active database transaction. The existing
TypeORM mutation normalization is preserved in a shared helper; the old Safe
Repository name is now a compatibility export instead of another overriding class.
The existing public SubscriptionAware Repository retains its creation-time cutoff.
No migration or external HTTP API contract is changed.

## Consumer effects and queue notifications

Consumer processing reacquires and locks its own receipt before writing effects.
Delivery insertion, receipt completion and Audit share that transaction. Endpoint
selection uses the same EntityManager. There is no Redis or HTTP call under that
lock. Lost ownership cannot create extra delivery rows or Audit.

Queue notification follows commit. Failure cannot reclassify a committed success as
failed. Relay now rediscovers pending deliveries as well as due retries, alongside
its existing pending-schedule scan. Pending items and retries are ordered by their
actual due time rather than placing every NULL retry timestamp last. Notifications and external HTTP remain at-least-once;
queue job IDs, conditional claims and receiver idempotency remain necessary.
This does not implement R05's complete event/schema registry or final consumer
failure recovery policy. Unsupported event handling is unchanged in this slice.

## Webhook result transaction

The Repository locks Delivery then its matching processing Attempt, then applies
both results and any Endpoint counter update. Audit participates in the caller's
same transaction. Failure during persistence is propagated and is not caught as an
HTTP failure that triggers a second finalization.

Endpoint counters are updated only for the captured Endpoint configuration version
while active. A response to an older URL/secret/enable policy cannot reset or disable
the newly configured policy. Different current deliveries are ordered by completion,
not by HTTP start time. Late HTTP may still reach the receiver; fencing does not undo
an external effect or cancel a frozen process's eventual network call.

Recovery updates precisely the locked Delivery set and only each matching current
Attempt in one transaction. It cannot broadly update rows skipped by SKIP LOCKED.
A missing matching processing Attempt is treated as inconsistent data and aborts
recovery rather than masking corruption. Retry claims respect persisted due time;
manual retry retains attempt count and old results remain invalid.

## Verification and boundaries

The permanent Eventing Attempt Ownership Gate applies real historical migrations
in a unique test schema, uses actual Repository, Relay, Consumer, Webhook Service
and Audit persistence, and coordinates two independent PostgreSQL connections.
pg_blocking_pids verifies actual contention for the blocking races. Queues and the
HTTP sender are controlled test doubles to simulate late and failed external calls;
this is not a full BullMQ or network test. Existing real Eventing/API/Media and UI
gates remain required.

It also tests post-commit notification loss, pending-work rediscovery, rollback of
delivery insertion with receipt/Audit, and rollback of webhook results/counters when
Audit fails. Pure contract tests cover transaction requirements, malformed owners,
mutation-result shape and early stale exits. Checks must pass on the current Head;
local syntax or helper-only execution does not constitute full acceptance.

The gate reads only an explicitly enabled loopback database named
atlas_eventing_attempt_test via ATLAS_EVENTING_ATTEMPT_TEST_DATABASE_URL. It never
uses application DATABASE_URL and drops only its uniquely named schema. Formatting
diagnostics generate a diff in RUNNER_TEMP, never modify or commit product source.

## Rollout and remaining blockers

Drain and stop ALL old Eventing workers before rollout or rollback; an old binary
can still issue ID-only writes. Do not mix old and new workers. No operational DB
migration, main/develop integration or deployment is performed by this slice.

R03 exact target pinning and a durable Publication business-effect receipt remain
unimplemented; R04-A only fences schedule bookkeeping. R05 event registry/replay,
Webhook absolute deadline, response retention and versioned encryption keyring
remain separately audited work. Green ownership tests do not complete Phase 9.
