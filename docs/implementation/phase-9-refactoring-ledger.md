# Phase 9 refactoring ledger

## R00-B: source reconciliation

Reviewed source: `22f1a6633a63f08083f4ce25a35368ff9f630d87` on
`feat/outbox-webhook-scheduling`, PR #31. The integration baseline is
`20f3d718d0e1d551025158eadbe68f2850c4f503` on `develop` (R00-A and R01
merged separately). Phase 9 is still Draft and unmerged.

Removed the one-time schedule-snapshot workflow and its two Python source
rewriters. Their proposals remain in Git history, not in executable delivery
paths. Successful checks in a runner do not prove those proposals were committed.
Subsequent corrections must be ordinary product commits with their own tests.
No automatic source recovery, forced integration merge or production deployment
is authorized by this ledger.

## Confirmed product behavior at the reviewed source

- The SafeTypeOrmEventingRepository normalizes mutation RETURNING results.
- The revision-alignment migration adds nullable revision_id/revision_number.
- That migration's CHECK still allows a populated ID with a NULL number.
- PublicationSchedulingService does not yet persist immutable publish/withdraw
  targets; generic publication commands remain in use.
- Workflow success alone is not acceptance of target-pinned scheduling, claim
  fencing, or transactional effect receipts.

## Remaining acceptance blockers

1. R02: forward-only schema expansion, explicit revision pair validation and
   ownership constraints; no guesses when migrating historical schedule targets.
2. R04: a recovered worker claim must reject late completion/failure by an older
   worker attempt.
3. R03: fixed targets and a durable effect receipt committed atomically with
   Publication, Audit and Outbox changes, including crash-window tests.
4. R05 and other audited reliability items remain separate, explicit work.

PR #31 must remain Draft while these correctness blockers are unresolved.
Do not deploy a schema/worker combination that silently ignores pinned targets.
All reported checks must identify their source head and whether the checkout was
that head or GitHub's synthetic pull-request merge. Integration requires a new
review against current develop and new exact-revision validation.
