# R05-B — Durable Consumer retry, dead state, replay and queue reconciliation

The Outbox status still describes transport to the queue. Consumer success/failure
is not projected back onto it. PostgreSQL receipts own execution budgeting and due
times; BullMQ jobs are replaceable notifications with one queue-level attempt.

## Lifecycle

`pending -> processing -> succeeded` is the success path. A retryable failure enters
`failed` with a persisted next attempt (5 seconds, 30 seconds, 2 minutes, 10 minutes).
Five started attempts exhaust a cycle. An invalid Event contract enters `dead`
immediately. Expired processing attempts are observed as abandoned; they count
against the same budget and never reset counters. Current receipt ownership is
locked before effects and checked on finalization. Receipt changes, terminal attempt
history, and the existing success/failure Audit share the effect/failure transaction.
A failed Audit cannot manufacture an acknowledged success or failure.

History records observations after this migration, not invented pre-migration runs.
Pending/processing work is visible through its receipt. Attempt history is appended
at finalization/recovery. Historical unclassified FAILED receipts are quarantined as
`dead / legacy-unclassified`, rather than automatically replayed on rollout. Existing
successful receipt fields and immutable payloads are preserved. Rollback is refused
once state or evidence would be lost; an empty-state down/up remains supported.

## Queue recovery

The existing Relay also finds dispatched Outbox events with no receipt after a
30-second grace window, pending/due failed receipts, and expired processing claims.
It materializes missing receipts, reserves a bounded batch under SKIP LOCKED and
records an incrementing notification version plus a 30-second notification lease.
The queue call occurs after DB commit. A lost notification or queue registration
error is re-discovered after the lease. Notification versions do not consume the
business retry budget. Versioned Job IDs avoid retained failed/completed jobs
blocking later recovery. Normal claim checks still gate due time and terminal status;
old/duplicate jobs cannot bypass them. No Redis-wide clearing is used.

Success receipts never replay. This is DB effect idempotency plus at-least-once
notifications, not exactly-once HTTP delivery. Loss of PostgreSQL itself is outside
this protocol. Notification retention in Redis follows existing bounded policies.

## Operator API

- `GET /api/admin/v1/eventing/consumptions?status=dead&limit=50`
- `GET /api/admin/v1/eventing/consumptions/{eventId}/history?limit=50`
- `POST /api/admin/v1/eventing/consumptions/{eventId}/replay`

Replay requires a UUIDv7 replayId, expectedAttempt, and one of dependency-restored,
handler-upgraded, operator-reviewed. Only a dead receipt in the authenticated
Workspace is eligible. The immutable Event must pass the current registry. A replay
ID is idempotent for the identical actor/target/input, not reusable for another
request. Replay preserves total attempts, old history and payload; it grants five
new attempts, stores immutable replay evidence and an Audit in one transaction.
Queue notification is left to the durable Relay. Read APIs expose only selected
status/history fields, not payloads or raw exception text. No arbitrary reason text
is persisted. Existing SITES_READ/SITES_MANAGE guards and CSRF protect these routes.
No management UI is added in this slice.

## Acceptance and rollout boundary

The new permanent gate exercises actual PostgreSQL migrations and production
Repository/Consumer/administration code. It also uses the compiled production
BullMQ adapter and real Redis to test retained failed and missing jobs. Unique
owned schemas and queue names are the only cleanup targets. Controller tests check
compiled guard metadata and DTO validation; they are not authenticated HTTP tests.
Existing authentication, Eventing, Media, scheduling and browser gates remain required.

Drain and stop old Eventing Workers before migration and coordinated API/Worker
rollout. Old binaries do not implement these lifecycle contracts. Mixed versions are
not supported. Keep PR #31 Draft until the remaining security and operational
acceptance items are complete. No production migration or deployment is authorized
by a successful CI run.
