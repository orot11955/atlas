# R04-A — Publication Schedule attempt ownership

## Scope and invariant

This slice fences Publication Schedule lifecycle writes. It does not implement
R03 pinned Publication targets or atomic business-effect receipts. Outbox,
Consumer and Webhook ownership remain separate R04-B work.

A committed claim returns the schedule ID, Workspace ID, monotonically increasing
attempt count and version. The processor captures those values from that claim,
not from a later reload. Completion and failure updates require all four values
and `status = processing`. A changed-row count of one permits lifecycle Audit in
the same transaction. Zero means stale ownership and produces no lifecycle Audit.
An absent, invalid or unexpectedly large affected-row count aborts the transaction.

Stale recovery changes only eligible processing rows, increments version and
preserves attempt count. Cancellation, retry and subsequent claims also advance
version. Attempt counts are not reset by manual retry. Late success or failure
cannot finish, retry, fail or resurrect a newer attempt or a cancelled schedule.

Claims, recovery and terminal updates reject an EntityManager without an active
transaction. Commands still execute outside the schedule bookkeeping transaction.
The original command failure is rethrown for queue diagnostics even when the stale
failure's lifecycle update is rejected. Such an obsolete job cannot claim again.

## Rollout restrictions

No schema migration is introduced; existing version and attempt columns provide
the fence. That is not protection against an old binary performing ID-only writes.
Stop and drain **all** old Schedule workers before activating this implementation.
Do not operate mixed old/new workers. Disable scheduling and drain processors
before rolling back to a version without ownership checks. API/worker rollout and
R03's mandatory target transition must be coordinated; this PR is not deploy-ready.

The remaining business-effect crash window is explicit: a publish/withdraw command
can commit before schedule completion, then execute again after recovery. R03 must
record an idempotent effect receipt atomically with Publication, Audit and Outbox.
Passing this gate does not prove exactly-once Publication effects or target pinning.

## Permanent verification

`Publication Schedule Attempt Gate` uses Node 24, the repository's locked pnpm
version and PostgreSQL 17. Both PR synthetic-merge and exact-feature push runs are
supported. It never rewrites or commits source and has read-only repository access.

The runner accepts only the explicitly enabled loopback database named
`atlas_schedule_attempt_test`; it does not read application `DATABASE_URL`.
It creates a uniquely named private schema, applies every real compiled migration,
uses the actual public Repository/Processor/Audit implementations and removes only
its own schema. Two independent PostgreSQL sessions act as workers; a third
observes and seeds state. `pg_blocking_pids()` proves contested updates actually
waited for the other worker before assertions continue.

Coverage includes concurrent claims, invalid owners, stale recovery before retry,
late success and retryable/terminal failure after a new owner succeeds, late success
while the new owner is still processing, cancellation, monotonic manual retry,
completion/recovery lock races in both orders, and rollback when Audit persistence
fails after inserting. Entire rows and stored Audit records are compared, not just
status fields. Target fields remain nullable as allowed by R02's expansion phase;
update those fixtures when R03 makes targets mandatory.

Publication Commands are controlled test doubles used to delay external execution.
This is an actual database concurrency test of scheduling bookkeeping, not a full
Publication effect or network test. Existing real API/Eventing/Media and browser
gates remain required. Local syntax-only checks are not acceptance evidence.

## Reproduction

```sh
pnpm install --frozen-lockfile
pnpm build:packages
pnpm --filter @atlas/server test
NODE_ENV=test ATLAS_ALLOW_ATTEMPT_TESTS=1 \
  ATLAS_ATTEMPT_TEST_DATABASE_URL='postgresql://atlas:atlas-attempt-test@127.0.0.1:5432/atlas_schedule_attempt_test' \
  node scripts/ci/publication-schedule-attempt-e2e.mjs
```

Use only an isolated test PostgreSQL instance. Acceptance requires the latest
reviewed Head's CI plus this gate; do not reuse historical green runs as evidence
for a changed source tree. No production migration or deployment is performed.
