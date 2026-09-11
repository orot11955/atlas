# R05-D — Webhook storage encryption-key rotation

This slice rotates the storage encryption key, not the HMAC signing Secret shared
with external receivers. It does not change MFA keys. Production key changes need
separate operational acceptance. No new migration or dependency is introduced.

## Format and configuration

The historical `w1.iv.tag.ciphertext` format, 12-byte IV, 16-byte GCM tag and
`atlas.webhook-secret\0{keyVersion}` AAD are preserved. Only the active key encrypts.
Decryption selects the exact stored version and its AAD; unavailable versions never
fall back to another key. Existing two-argument constructors remain compatible.

The optional third argument is `WEBHOOK_SECRET_DECRYPT_KEYS_JSON`: an array of
objects with exactly `version` and `keyBase64` string fields. Its default is `[]`.
At most eight additional read keys are accepted. Duplicate versions or key bytes,
malformed JSON and invalid key material fail without echoing their values.

API and Worker Config and providers read the new value. Their asynchronous provider
checks stored version coverage before returning the Cipher. This tests version
availability, not correctness of same-version key bytes or configuration across a
fleet. Authentication of each ciphertext detects incorrect bytes.

**Compose integration is pending.** This commit does not modify `compose.yml` to
pass the new variable into API/Worker containers. The existing Compose stack keeps
its previous single-key behavior; do not consider multi-key Compose rollout ready.
The standalone operator CLI reads explicit environment configuration. There is no
alternative Compose override or source-rewriter introduced in this slice.

Keys must not enter Git, request DTOs, CLI arguments or logs. ECMAScript private
fields prevent ordinary object/JSON serialization of key bytes; they do not promise
memory-dump protection, environment access control or forced JavaScript zeroization.

## Re-encryption boundary

A separate Maintenance Service and Repository Port keep this concern out of the
existing Eventing Repository. Up to 50 rows in one Workspace are locked with
`FOR UPDATE SKIP LOCKED`. Decrypt, encrypt, round-trip check, conditional UPDATE and
Audit share one transaction. A decryption, CAS or Audit failure rolls back the whole
batch. Output and Audit contain no key bytes, ciphertext or signing Secret.

The UPDATE compares endpoint ID, Workspace, endpoint version, old ciphertext and
old key version. Only the stored representation changes. The signing Secret,
endpoint version/updatedAt, status, URL, failure policy and all delivery/event data
remain unchanged. Ordinary signing-secret rotation uses the same row lock and
increments endpoint version; a stale maintenance CAS cannot restore its old value.

`changed=0` may mean rows were locked and skipped, not that migration is complete.
Recheck global/scoped inventory. Unreadable rows are not automatically skipped or
repaired by guessing. The batch limit bounds rows, not an operator's entire rollout.

## Operator CLI

Run from the repository root after building packages. The CLI does not run
migrations, boot API/Worker, send HTTP or start queues. It uses explicit environment
configuration and opens its own non-logging, timeout-bounded database connection.

```bash
node --env-file=.env scripts/operations/webhook-encryption-key.mjs inspect
node --env-file=.env scripts/operations/webhook-encryption-key.mjs inspect --workspace <workspace-uuidv7>
node --env-file=.env scripts/operations/webhook-encryption-key.mjs reencrypt \
  --workspace <workspace-uuidv7> --expected-active-version v2 --limit 25 --apply
node --env-file=.env scripts/operations/webhook-encryption-key.mjs retire-check --version v1
```

Default invocation is read-only inventory. A write requires Workspace, expected
active version and explicit `--apply`. No argument accepts keys or plaintext.
Audit uses `system / cli:webhook-encryption`; use host access records to attribute
individual operators. This adds no public HTTP route or API permission bypass.

## Coordinated rollout and retirement

1. Deploy keyring-capable binaries to every API/Worker. Preload v2 for reading while
   v1 remains active. Do not mix old single-key binaries with new-key writes.
2. Switch active writes to v2 and retain v1 for reads. Never reuse a version label
   for different key bytes. Verify writers and drain/stop old writer processes.
3. Re-encrypt small Workspace batches, including disabled endpoints.
4. Inspect all Workspaces and run `retire-check` to confirm no stored v1 references.
5. Drain in-flight old snapshots/processes before removing v1 from read configuration.
   Preserve old keys separately while backups may require them for restoration.

`retire-check` is a point-in-time database check and never deletes key material.
It cannot fence other processes, later old writers, backups or Secret Store deletion.
A complete fleet rollout and backup-restore drill remain operational responsibilities.
Compose deployment additionally requires the pending configuration forwarding above.

## Verification boundaries

Cipher/Application tests and CLI argument tests are included. Application unit
tests use explicit in-memory transactions, not PostgreSQL locks. The permanent
Webhook Safety Gate also applies every historical migration to an isolated owned
schema and runs `webhook-key-rotation-e2e.mjs`: signatures/non-storage field
preservation, Audit rollback, corrupt ciphertext rollback, independent connections
with SKIP LOCKED, stale CAS against signing-secret rotation, global coverage and
actual decryption after removing the old key. Existing transport/diagnostic checks
remain intact. Each final Head must pass the normal full CI as well.

Test success is not production rotation, KMS deletion, full fleet validation,
network-to-database delivery acceptance or merge approval. Keep PR #31 Draft until
Compose forwarding and the other Phase 9 operator/security acceptance items finish.
