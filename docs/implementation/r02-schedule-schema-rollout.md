# R02: publication schedule schema expansion

## Scope and acceptance

This is an additive schema preparation, not working target-pinned scheduling.
The new migration and nullable Entity field do not change the HTTP contract or
start recording targets in the existing Application service. R03 must connect
Domain, repository mappings, API views and exact-target execution. PR #31 remains
Draft; this change is not a production-release approval.

Historical migrations are unchanged. R02 adds a nullable target_publication_id,
validates revision ID/number as a pair, and checks ownership through composite
foreign keys (workspace, content, site, ContentSite and revision number). Supplied
revision targets are publish-only; supplied publication targets are withdraw-only.
Both targets may still be NULL for historical rows and older writers. READY and
ACTIVE eligibility are Application checks for R03, not properties guaranteed by
these foreign keys.

A separate trigger makes all three target fields immutable without replacing the
existing definition/deletion guard. NULL-to-value backfills are also blocked.
Existing valid rows, statuses, attempts, versions and timestamps are not rewritten.

## Existing data and rollout order

1. Keep Phase 9 workers stopped for the maintenance window. Take a tested backup;
   record the old application SHA, migration list and pending schedule counts.
2. Run R02 with TypeORM transaction mode all or each, never none. Configure a
   bounded lock_timeout/statement_timeout for the maintenance connection. R02
   locks publication_schedules, builds three supporting unique indexes and
   validates existing rows; this is not a zero-lock online migration.
3. Partial revision pairs or mismatched ownership abort the transaction before
   schema expansion. No target is guessed from today's READY/ACTIVE pointers.
   Preserve the failing records and recover evidence before an explicitly reviewed
   repair migration. Merely marking an inconsistent row cancelled does not make
   its target/scope valid.
4. Leave valid legacy NULL targets untouched. Before R03 execution is enabled,
   cancel open legacy schedules through audited Commands and explicitly recreate
   intended schedules with confirmed targets. Preserve historical terminal rows.
5. Deploy target-aware writers and workers together only after R04 fencing and R03
   effect-receipt/crash-window tests pass. No older worker may process newly pinned
   records. R03 must reject execution of missing targets rather than falling back
   to the latest READY/ACTIVE object. Final required-target constraints belong to
   that coordinated rollout and must account for retained historical records.

## Rollback

Down requires a transaction and takes the schedule lock. It refuses to drop the
new column when ANY publication target exists, including cancelled/terminal rows.
A failed rollback leaves columns, constraints and data intact. With no publication
targets, down removes only R02 objects, preserves revision columns/values, and
restores the previous nullable-pair CHECK. Do not bypass triggers or clear target
fields to force a rollback; use a reviewed forward fix or restore a tested backup.

## Permanent PostgreSQL contract gate

Publication Schedule Schema Gate builds the actual packages and runs every
historical migration before R02 in a unique test schema. It checks legacy-defect
rejection without data loss, unchanged upgrade data, NULL pairs, ownership,
Entity/table column parity, immutable targets, lifecycle updates, safe down/up,
and refusal to destroy recorded targets. Negative tests run in savepoints.

The runner accepts only an explicit loopback URL for database
atlas_schedule_schema_test with NODE_ENV=test and ATLAS_ALLOW_SCHEMA_TESTS=1.
It does not read DATABASE_URL or the application DataSource, does not synchronize
entities, and drops only the unique schema it created. This is a schema contract
suite, not a Worker scheduling, API authorization or real delivery test.

Local Node syntax checks or mock compilation are not PostgreSQL acceptance. Record
actual workflow head, checkout revision and results before claiming completion.
