# R05-C — Webhook transport deadlines and zero raw-response retention

## Transport boundary

NodeWebhookSender uses one absolute, monotonic deadline starting before URL policy
and DNS resolution. The same budget covers DNS, TCP connection, TLS negotiation,
request transmission, headers and response reading. It does not reset on incoming
bytes. Expiry aborts the request and closes any response/socket. All success/error
paths clear the deadline timer and remove the cancellation listener.

The operating-system DNS lookup API itself cannot be cancelled. The caller stops
waiting at the deadline, and a late lookup result is checked against both the abort
signal and the monotonic expiry before any socket is opened. This bounds the
observable send operation, not the lifetime of a native resolver task or a blocked
JavaScript event loop. Resolver semantics still include the OS hosts configuration;
they were not replaced with a DNS-only resolver. The optional resolver argument is
a trusted composition/test seam, not an endpoint-controlled option.

Existing URL/private-network checks remain; every returned DNS address is checked
before pinning one. HTTP redirects are not followed. HTTPS certificate verification
remains enabled and DNS targets retain their original hostname for SNI. Mandatory
Host and body-length headers cannot be overridden by differently cased caller
headers. Production's existing composition still disables HTTP/private networks.

Response data is counted and discarded, not concatenated into a diagnostic string.
Oversized Content-Length closes the connection immediately, without background
draining. Chunked responses close when their byte limit is crossed. A bounded,
complete response returns only its status and, when nonempty, an omission marker.
An oversized response preserves the received HTTP status and an oversize marker;
it is not proof that the entire remote response was read. Truncated responses fail.
The current configured byte limit is retained. Runtime limits reject invalid byte
caps and timeouts (maximum 1 MiB response/request bytes and 120 seconds).

## Diagnostic persistence policy

Raw response-body and arbitrary exception-message retention is zero. Compatibility
fields keep their names but may contain only fixed omission/failure markers. This
is not pattern-based secret detection: unknown bodies are omitted in full, whether
JSON, HTML, text or binary. HTTP status, attempt identity, timestamps and existing
Audit metadata remain available. The Service sanitizes even an alternate Sender's
output, and validates HTTP status before acknowledging success (NaN cannot succeed).
Persistence/Audit failure remains separate from transport failure and never causes
a second result write. Existing attempt ownership and late-result fencing remain.

Migration 1788696000000 replaces historical external diagnostic text with fixed
markers and adds CHECK constraints to both Delivery and Attempt diagnostic fields.
It preserves all signed request bytes, statuses, identifiers, counters, timestamps,
Event payloads, Publication snapshots and Audit records. Schema down removes the
new constraints, but cannot restore discarded raw text. This data transformation
is intentional and must be reviewed before applying the migration. Existing backup
copies are not erased or rewritten by this migration; backup retention/access is
an operator responsibility. The migration must run in a coordinated maintenance
window after old Workers are drained; large tables require a row-count/lock-budget
preflight. Mixed-version Workers can violate the new constraints and are unsupported.

## Verification and limits

Unit tests exercise actual loopback HTTP/TCP sockets: delayed DNS with late-result
suppression, shared DNS/header budget, stalled headers, trickled body, stalled TLS
handshake, oversized declared/chunked bodies, truncated responses, no redirects,
pinned Host/signature/body preservation and policy rejection. They do not call
public receivers. TLS certificate/SNI settings are retained in production code;
this slice does not introduce a full PKI/certificate-rotation acceptance suite.

The permanent Webhook Transport Safety Gate additionally applies actual migrations
to a unique owned PostgreSQL schema. It seeds legacy diagnostic data before the new
migration and checks exact preservation of other fields, SQL rejection of new raw
text, actual Repository/Delivery Service/Audit transactions, safe read views, late
owner fencing, Audit rollback and non-restorative schema down/up. Its Sender is a
controlled adapter; transport tests are separate, not a consolidated network/DB E2E.

Remaining blockers: encryption-key rotation, authenticated HTTP acceptance for
Consumer management, schedule target DTO/UI and legacy-schedule operator handling,
and coordinated rollout acceptance. Keep PR #31 Draft; passing this slice does not
authorize a merge, production migration or deployment.
