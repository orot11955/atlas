# Phase 9 — Outbox, Webhook & Scheduling

## 결과

Atlas의 Business Transaction 이후 부작용을 Transactional Outbox와 BullMQ로 전달한다. Job은 At-least-once로 실행될 수 있지만 `event_consumptions`, Webhook Delivery Unique Constraint와 Publication Schedule 조건부 Claim으로 같은 결과가 중복 반영되지 않는다.

```text
Business Transaction
├─ Domain 변경
├─ Audit 기록
└─ OutboxEvent INSERT
        ↓
Outbox Relay
├─ FOR UPDATE SKIP LOCKED
├─ Claim Timeout과 Stale Recovery
├─ BullMQ enqueue, jobId = eventId
└─ dispatchedAt 기록
        ↓
Consumer
├─ EventConsumption UNIQUE(consumerKey, eventId)
├─ Webhook Delivery 또는 Publication Schedule Job 생성
└─ Result Summary 저장
```

## 데이터 모델

```text
OutboxEvent
EventConsumption
WebhookEndpoint
WebhookDelivery
WebhookDeliveryAttempt
PublicationSchedule
```

Migration:

```text
packages/database/src/migrations/
└─ 1788130800000-CreateOutboxWebhookScheduling.ts
```

Outbox Event의 Identity, Type, Payload와 생성 시각은 PostgreSQL Trigger로 변경·삭제를 차단한다. Webhook Attempt의 Request Body와 Publication Schedule 정의도 생성 이후 불변이다.

## Outbox Relay

Relay는 사용 가능한 Event를 `FOR UPDATE SKIP LOCKED`로 Claim한다. Claim 중 Worker가 종료되면 `claimedAt`과 설정된 Timeout을 기준으로 회수한다.

```text
pending
→ processing
→ dispatched

processing 중 enqueue 실패
→ pending + backoff
→ 최대 시도 초과 시 dead
```

BullMQ의 Outbox Job ID는 Event ID와 동일하다.

```text
Queue    SYSTEM_QUEUE_NAME
Job      outbox.consume
Job ID   {eventId}
```

Dead Event는 관리자 API에서 수동 재시도할 수 있다. Outbox 목록 응답에는 Payload를 포함하지 않는다.

## Consumer Receipt

Consumer는 다음 Unique Constraint를 Idempotency 경계로 사용한다.

```text
UNIQUE(consumer_key, event_id)
```

동일 Event Job이 여러 번 실행돼도 성공한 Receipt가 있으면 부작용을 다시 수행하지 않는다. Processing 중 Worker가 종료되거나 실패한 Receipt는 Claim Timeout 이후 재시도할 수 있다.

## Webhook

Site별 Endpoint는 다음 Event를 구독할 수 있다.

```text
content.published
content.unpublished
```

Secret은 생성·회전 응답에서 한 번만 반환한다. DB에는 AES-256-GCM Ciphertext와 Key Version만 저장한다.

Webhook Signature:

```text
payload = timestamp + "." + eventId + "." + rawBody
signature = "v1=" + HMAC-SHA-256(secret, payload)
```

전송 Header:

```text
X-Atlas-Delivery-Id
X-Atlas-Event
X-Atlas-Event-Id
X-Atlas-Timestamp
X-Atlas-Signature
```

보안 경계:

- 운영 환경에서는 HTTPS만 허용한다.
- 운영 환경에서는 Loopback, Link-local, Private Network와 Redirect를 허용하지 않는다.
- DNS 해석 결과도 Private Address 여부를 검사한다.
- Response Body는 설정된 최대 크기를 넘으면 즉시 중단한다.
- Timeout, Retry Backoff, Dead 상태와 Endpoint Disable Policy를 적용한다.
- Secret, Authorization Header와 전체 Response Body를 Audit 또는 DTO에 기록하지 않는다.

Webhook Delivery는 `(endpointId, eventId)` Unique Constraint로 생성한다. 동일 Event를 다시 Consumer해도 Delivery Row는 하나다. 실패 시 같은 Event ID와 Raw Body를 사용해 재시도하며, 관리자는 Dead 또는 Retry Scheduled Delivery를 수동 재전송할 수 있다.

## Publication Scheduling

관리자는 Site Timezone의 Local DateTime으로 Publish 또는 Withdraw를 예약한다. API는 IANA Timezone으로 유효성을 검사하고 UTC `scheduledFor`로 저장한다.

```text
pending
→ processing
→ completed

processing 실패
├─ pending + backoff
└─ 최대 시도 초과 시 failed

pending
└─ cancelled
```

동일 `ContentSite`에 열린 Schedule은 하나만 허용한다.

```text
UNIQUE(workspaceId, contentSiteId)
WHERE status IN ('pending', 'processing')
```

Due Scanner가 같은 Schedule을 여러 번 Queue에 넣어도 `status = pending`, `nextAttemptAt <= now`, `attemptNumber = attemptCount + 1` 조건을 모두 만족한 Worker 하나만 `processing`을 획득한다. 실행 직전에 Content, Site, READY Revision과 현재 Publication 상태를 다시 검증한다.

## Admin API

```text
GET  /api/admin/v1/eventing/outbox
POST /api/admin/v1/eventing/outbox/{eventId}/retry

GET   /api/admin/v1/webhook-endpoints
POST  /api/admin/v1/webhook-endpoints
PATCH /api/admin/v1/webhook-endpoints/{endpointId}
POST  /api/admin/v1/webhook-endpoints/{endpointId}/secret/rotate
POST  /api/admin/v1/webhook-endpoints/{endpointId}/enable
POST  /api/admin/v1/webhook-endpoints/{endpointId}/disable

GET  /api/admin/v1/webhook-deliveries
POST /api/admin/v1/webhook-deliveries/{deliveryId}/retry

GET  /api/admin/v1/publication-schedules
POST /api/admin/v1/publication-schedules
POST /api/admin/v1/publication-schedules/{scheduleId}/cancel
POST /api/admin/v1/publication-schedules/{scheduleId}/retry
```

모든 변경 API는 Admin Session, Workspace Scope, Permission과 Double-submit CSRF를 요구한다. Version이 있는 변경은 Optimistic Lock을 적용한다.

## Admin Web

```text
/admin/webhooks
/admin/contents/{contentId}
```

Webhook 관리 화면에서 Endpoint 등록·수정, Secret 1회 확인, 회전, Enable/Disable, Delivery 상태, Attempt와 수동 재전송, Dead Outbox 재시도를 제공한다. Content Publication Manager에서는 Site Timezone 기준 Publish/Withdraw Schedule 생성·취소·실패 재시도를 제공한다.

## 검증

영구 `Eventing Data Gate`는 실제 PostgreSQL, Redis, API, Worker와 HTTP Receiver를 함께 실행한다.

```text
OWNER Bootstrap
→ Password + TOTP + Session
→ Webhook Endpoint 생성과 Secret 1회 반환 확인
→ Content Publish
→ Transactional Outbox 생성
→ Receiver 503
→ Retry Scheduled와 실패 Attempt 확인
→ 같은 Event ID·Timestamp HMAC으로 수동 재전송
→ Secret 회전
→ Scheduled Withdraw
→ 중복 Schedule 거부
→ Due Scanner 실행
→ Content Unpublished Webhook
→ Republish 후 새 Secret Signature 확인
→ Schedule Cancel
→ Endpoint Disable
```

Database Gate는 Outbox Dispatch, Consumer Receipt, Delivery/Attempt 상태, Schedule 완료·취소, Secret 원문 비노출과 Audit 기록을 확인한다.
