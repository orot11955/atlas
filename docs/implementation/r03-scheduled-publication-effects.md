# R03 — Pinned Publication targets and durable business effects

Scheduling captures the selected READY Revision (ID and number), or the active
Publication ID. ContentSite and Content rows are locked in that order and then
re-read, avoiding an outdated joined pointer after a lock wait. Target fields are
immutable; no execution falls back to current READY/ACTIVE pointers.

The additive migration requires complete targets for NEW inserts. Historical
unpinned rows are retained without inferred backfills, remain readable and can be
cancelled while pending. Execution fails closed; retry does not invent intent.
Drain old workers, pause scheduling writes, cancel/recreate pending legacy rows
with explicit approval, migrate, and activate the new API and workers together.
Do not run mixed old/new workers or roll back without draining.

Scheduled commands lock the schedule using the committed attempt identity. That
lock is held across Publication changes, their Audit and Outbox, and one immutable
receipt keyed by schedule ID. The existing Publication service is constructed with
a transaction-bound runner: it must NOT start an independent transaction. No HTTP,
Redis or MinIO operation is performed by this execution transaction; Media reads
come from the existing immutable Revision asset sources and URL builder.

A receipt is consulted before current Content/Publication state. Recovery after
business commit but before schedule bookkeeping therefore cannot republish an old
Revision over a later manual publication. An already superseded/withdrawn target
is a recorded no-op; a newer active Publication is never withdrawn by that schedule.
The outcome and resulting Publication reference are immutable and scope-checked.
Receipt insertion failure rolls back the entire business effect. Down refuses to
destroy any recorded receipt. Empty down/up is supported.

The permanent read-only Effects Gate uses actual compiled migrations, PostgreSQL,
Repository, Publication service, Audit and Outbox. It injects failures at Audit,
Outbox and receipt insertion, and pauses commands to verify real row-lock waits.
The crash window test deliberately omits bookkeeping after effect commit and then
recovers through a different database connection. It is not an OS-kill or a live
HTTP/BullMQ test. Existing API/Eventing/Media/UI gates remain required.

PublicationCommandPort is now explicitly scheduled-only. R04-A lifecycle tests
retain controlled command doubles under the new executeScheduled contract; their
fixtures provide complete database targets without changing ownership assertions.
Read DTOs and UI changes are not part of this slice. R05 Consumer registry/replay,
Webhook deadline/retention/key rotation and other audit items remain unresolved.
This branch is not approved for integration or production merely because this gate
passes.
