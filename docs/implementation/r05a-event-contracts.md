# R05-A — Versioned Event contracts and fail-closed consumption

A frozen registry maps each of the five current EventType values to schema version
1, the aggregate kind, site scope and an explicit handler. The compiler requires
new EventType values to choose a descriptor. Prototype properties and unknown
versions/types do not select a fallback handler.

The producer validates before inserting, in the caller's domain transaction. The
Consumer validates after reacquiring its receipt ownership lock, before durable
side effects. Validation compares event ID, Workspace, Site, aggregate ID, type
and schema version between the persisted row and envelope. Publication and
schedule events require Site scope; the existing Workspace-scoped manual Webhook
retry contract permits a null Site. Identifiers are canonical lowercase UUIDv7.

Publication v1 requires publicationId/contentId/contentSiteId/revisionId,
revisionNumber, slug and etag; published additionally requires visibility. Optional
rollback/replacement IDs and scheduled flags are type checked. Schedule and
Webhook retry v1 require the matching aggregate target, a positive integer attempt
and a canonical UTC ISO timestamp. Timestamp strings are never loosely coerced.
V1 retains bounded JSON extension fields for compatibility, but these cannot select
handlers or override routing arguments. Data is limited to 256 KiB, depth 32 and
20,000 visited values. This is not payload-secret redaction.

Failures are EventContractError with a fixed reason and VALIDATION_FAILED, not the
rejected type/value/body. The current owner's FAILED consumption and failure Audit
are committed together. No success Audit, Delivery or queue notification is made.
An obsolete owner cannot record a failure for a new owner. A registered Publication
with zero subscriptions is an explicit successful zero-effect outcome; an unknown
Event is never that outcome.

The permanent ownership PostgreSQL suite retains all 21 concurrency/Audit cases,
updates synthetic fixture IDs/payloads to the production contract, and adds 15
contract/isolation/rollback scenarios. Invalid legacy payloads are inserted only
through the test Repository, not the validated producer. Real Repository, Consumer,
Audit and historical migrations are used; queue calls are controlled doubles.
The separate real API/Eventing/Media and browser gates remain mandatory.

R05 is NOT complete: final consumer retry budget, dead state, manual replay and
queue-loss reconciliation are R05-B. This slice keeps existing FAILED receipts and
existing BullMQ retries; poison events are rejected, not automatically quarantined
into a new terminal state. Previously succeeded receipts are not rewritten or
retroactively replayed. No migration, dependency or public response format changes
are included. Old malformed events may now fail and require explicit operator
handling; do not infer targets or rewrite immutable payloads.

Keep PR #31 Draft. Drain old workers before a coordinated rollout; this is not
mixed-version safe. Green contract tests alone are not Phase 9 integration approval.
